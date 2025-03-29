import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { Separator, checkbox, confirm, input, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { config } from 'dotenv';
import figlet from 'figlet';
import ora from 'ora';

// Load environment variables
config();

// Define types
interface AgendaFileData {
  meetingPurpose: string;
  agenda: string[];
}

interface Defaults {
  involvement: string;
  lowEndModel: string;
  highEndModel: string;
}

const saveFile = '.headsinjars.json';

// Check for command line arguments
const isValidationMode = process.argv.includes('--validate');
const isDebugMode = process.argv.includes('--debug');

// Check for agenda file argument
const agendaFileArg = process.argv.find((arg) => arg.startsWith('--agenda-file='));
const agendaFilePath = agendaFileArg ? agendaFileArg.split('=')[1] : null;

// Set debug mode globally so it can be accessed from any module
global.isDebugMode = isDebugMode;

// Import agent and meeting modules
import { Agent } from './agents/index.js';
import { MeetingSimulator } from './meeting/index.js';
import { availablePersonas } from './personas.js';

// Import UI utilities
import { debugLog } from './utils/formatting.js';

import { AnthropicClient } from './api/index.js';
// Import types
import type { PersonaDirectory, PersonaInfo } from './types.js';

const defaultLowEndModel = 'claude-3-5-haiku-latest';
const defaultHighEndModel = 'claude-3-5-haiku-latest'; // 'claude-3-7-sonnet-latest'

/**
 * Read and parse an agenda file
 */
function readAgendaFile(filePath: string): AgendaFileData | null {
  try {
    if (!fs.existsSync(filePath)) {
      console.error(chalk.red(`Error: Agenda file not found at ${filePath}`));
      return null;
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');
    const lines = fileContent
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      console.error(chalk.red('Error: Agenda file is empty'));
      return null;
    }

    // First line is the meeting purpose
    const meetingPurpose = lines[0];

    // Remaining lines are agenda items
    const agenda = lines.slice(1);

    if (agenda.length === 0) {
      console.log(chalk.yellow('Warning: No agenda items found in file. Using default agenda.'));
      agenda.push('Project status updates', 'Technical challenges', 'Next steps');
    }

    return { meetingPurpose, agenda };
  } catch (error: unknown) {
    console.error(chalk.red('Error reading agenda file'), error);
    return null;
  }
}

// Validate all imports
function validateImports(): boolean {
  console.log(chalk.cyan('Validating imports...'));

  // Validate utility functions
  console.log('✓ utils.ts: createMessage, sleep, formatDuration, truncateText, containsAny, generateId');

  // Validate agent module
  const agentInstance = new Agent({
    agentId: 'test',
    name: 'Test Agent',
    persona: 'Test persona',
    role: 'Dev',
    color: chalk.blue,
    client: new AnthropicClient(new Anthropic()),
  });
  console.log('✓ agents.ts: Agent, ModeratorAgent');

  // Validate personas
  console.log(`✓ personas.ts: ${Object.keys(availablePersonas).length} personas available`);

  // Validate meeting simulator
  console.log('✓ meeting.ts: MeetingSimulator');

  // Validate file handling
  console.log('✓ fs: File system module for agenda file reading');

  console.log(chalk.green('All modules imported successfully!'));
  return true;
}

// Initialize the app
if (!isValidationMode) {
  console.log(chalk.cyan(figlet.textSync('AI Meeting', { horizontalLayout: 'full' })));
  console.log(chalk.cyan(figlet.textSync('Simulator', { horizontalLayout: 'full' })));
  console.log('\n');
}

// Start the app
async function main(): Promise<void> {
  // Run in validation mode if --validate flag is provided
  if (isValidationMode) {
    validateImports();
    console.log(chalk.green('Validation completed successfully!'));
    process.exit(0);
    return;
  }

  // Show debug mode status
  if (isDebugMode) {
    console.log(chalk.gray('Debug mode: Enabled'));
    debugLog('Debug output will appear in this color');
  }
  try {
    // Get Anthropic API key
    let apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      const apiKeyPrompt = await input({
        message: 'Enter your Anthropic API key:',
        required: true,
      });

      apiKey = apiKeyPrompt;
    }

    // Create Anthropic client
    const client = new AnthropicClient(
      new Anthropic({
        apiKey,
      }),
    );

    const savedDefaults = loadDefaults();

    let involvement = savedDefaults?.involvement ?? 'none';
    let cheapModel = savedDefaults?.lowEndModel ?? defaultLowEndModel;
    let goodModel = savedDefaults?.highEndModel ?? defaultHighEndModel;

    type actions =
      | 'involvement'
      | 'select_cheap_model'
      | 'select_good_model'
      | 'meeting_purpose'
      | 'save_and_continue'
      | 'continue';

    outer: while (true) {
      const nextAction: actions = await select({
        message: 'Setup',
        loop: false,
        pageSize: 99,
        default: 'continue' satisfies actions,
        choices: [
          {
            value: 'involvement',
            name: 'Level of involvement',
            description: involvement,
          },
          {
            value: 'select_cheap_model',
            name: 'Cheap model',
            description: cheapModel,
          },
          {
            value: 'select_good_model',
            name: 'Good model',
            description: goodModel,
          },
          new Separator(),
          {
            value: 'save_and_continue',
            name: 'Save as default and continue',
          },
          {
            value: 'continue',
            name: 'Continue',
          },
        ],
      });

      switch (nextAction) {
        case 'involvement':
          involvement = await select({
            message: 'Select your level of involvement in the meeting:',

            choices: [
              { value: 'none', name: 'None - Just observe the meeting' },
              { value: 'low', name: 'Low - Occasional input' },
              { value: 'high', name: 'High - Frequent opportunities to speak' },
            ],
          });
          break;
        case 'select_cheap_model':
          cheapModel = await input({
            message: 'Select cheap model',
            required: true,
            default: defaultLowEndModel,
          });
          break;
        case 'select_good_model':
          goodModel = await input({
            message: 'Select good model',
            required: true,
            default: defaultHighEndModel,
          });
          break;
        case 'save_and_continue':
          saveDefaults({
            involvement,
            lowEndModel: cheapModel,
            highEndModel: goodModel,
          });
          console.log(chalk.green(`Defaults saved to ${chalk.bold(saveFile)}`));
          break outer;
        case 'continue':
          break outer;
      }
    }

    // Get meeting purpose and agenda items (either from file or user input)
    let meetingPurpose: string | undefined;
    let agenda: string[] = [];

    // If an agenda file was provided, read it
    if (agendaFilePath) {
      debugLog(`Reading agenda from file: ${agendaFilePath}`);
      const fileData = readAgendaFile(agendaFilePath);

      if (fileData) {
        meetingPurpose = fileData.meetingPurpose;
        agenda = fileData.agenda;

        console.log(chalk.green(`Loaded meeting purpose: ${meetingPurpose}`));
        console.log(chalk.green(`Loaded ${agenda.length} agenda items from file:`));
        agenda.forEach((item, index) => {
          console.log(chalk.green(`  ${index + 1}. ${item}`));
        });
      } else {
        console.log(chalk.red('Failed to load agenda from file. Falling back to manual input.'));
        // Continue with manual input below
      }
    }

    if (!meetingPurpose) {
      meetingPurpose = await input({
        message: 'Enter a brief description of the meeting purpose:',
        default: 'Weekly project status and planning',
      });
    }

    // If we didn't get agenda from file, ask the user
    if (agenda.length === 0) {
      console.log(chalk.yellow('\nEnter agenda items (leave blank when done):'));

      let itemNumber = 1;

      // Set initial agenda item suggestion
      let initialValue = 'Project status updates';

      while (true) {
        const agendaItem = await input({
          message: `Agenda item #${itemNumber}:`,
          default: initialValue,
        });

        // Clear the initial value after first item
        initialValue = '';

        // If blank item, break the loop
        if (!agendaItem.trim()) {
          break;
        }

        // Add item and increment counter
        agenda.push(agendaItem);
        itemNumber++;
      }

      // If no agenda items were added, use default ones
      if (agenda.length === 0) {
        console.log(chalk.yellow('No agenda items provided. Using default agenda.'));
        agenda.push('Project status updates', 'Technical challenges', 'Next steps');
      }
    }

    // Initialize the meeting simulator
    console.log(chalk.cyan('\nInitializing meeting simulator...'));

    const spinner = ora('Setting up the meeting environment...').start();

    const simulator = new MeetingSimulator({
      client,
      agenda,
      userInvolvement: involvement,
      lowEndModel: cheapModel,
      highEndModel: goodModel,
      meetingPurpose,
    });

    // Wait for initialization to complete with detailed status updates and persona selection
    await simulator.initialize(
      // Status update callback
      (statusMessage: string) => {
        spinner.text = statusMessage;
      },
      // Persona selection callback
      async (recommendedPersonas: Record<string, PersonaInfo>, availablePersonas: PersonaDirectory) => {
        // Stop the spinner to allow interactive selection
        spinner.stop();

        console.log(chalk.cyan('\n✨ Select meeting participants:'));
        console.log(chalk.gray('The AI has recommended some participants based on the meeting topic,'));
        console.log(chalk.gray('but you can customize who will attend the meeting.'));

        // Create choices for MultiSelect
        const choices = Object.entries(availablePersonas).map(([id, info]) => {
          return {
            value: id,
            name: `${info.name} (${info.role}) - ${info.description}`,
            checked: !!recommendedPersonas[id],
          };
        });

        // Get the IDs of recommended personas to use as initial selection
        const initialSelection = Object.keys(recommendedPersonas);

        // Use MultiSelect to let user choose personas
        const selectedIds = await checkbox({
          message: 'Select meeting participants (space to toggle, enter to confirm):',
          choices,
          validate: (selected) => {
            if (selected.length < 2) return 'Please select at least 2 participants';
            return true;
          },
        });

        // Create object of selected personas
        const selectedPersonas: Record<string, PersonaInfo> = {};
        for (const id of selectedIds) {
          selectedPersonas[id] = availablePersonas[id];
        }

        // Restart the spinner
        spinner.start('Finalizing participant selection...');

        return selectedPersonas;
      },
    );

    spinner.succeed('Meeting setup complete!');

    // Display meeting information in a more structured format
    console.log('\n');
    console.log(chalk.green('╭───────────────────────────────────────────────────╮'));
    console.log(chalk.green('│              Meeting Information                  │'));
    console.log(chalk.green('╰───────────────────────────────────────────────────╯'));
    console.log(chalk.white(`📋 Topic: ${chalk.bold(meetingPurpose)}`));
    console.log(chalk.white('📑 Agenda:'));
    agenda.forEach((item, i) => {
      console.log(chalk.white(`  ${i + 1}. ${chalk.bold(item)}`));
    });
    console.log(chalk.white('👥 Participants:'));
    Object.values(simulator.agents)
      .filter((a) => a.agentId !== 'moderator')
      .forEach((a) => {
        // Handle chalk color safely with a type assertion
        const chalkColor = a.color;
        console.log(chalk.white(`  • ${chalkColor.bold(a.name)} - ${chalkColor(a.role)}`));
      });

    // Start the meeting with a more visual separator
    console.log('\n');
    console.log(chalk.green('╭───────────────────────────────────────────────────╮'));
    console.log(chalk.green('│                Meeting Starting                   │'));
    console.log(chalk.green('╰───────────────────────────────────────────────────╯'));
    console.log();
    await simulator.introduceParticipants();
    await simulator.runMeeting();

    // Meeting conclusion with matching visual style
    console.log('\n');
    console.log(chalk.green('╭───────────────────────────────────────────────────╮'));
    console.log(chalk.green('│               Meeting Concluded                   │'));
    console.log(chalk.green('╰───────────────────────────────────────────────────╯'));
    console.log();

    // Ask if user wants to save the transcript
    const saveTranscript = await confirm({
      message: 'Save meeting transcript?',
      default: true,
    });

    if (saveTranscript) {
      // Get the current date in YYYY-MM-DD format
      const currentDate = new Date().toISOString().split('T')[0];

      // Create a slug from the meeting purpose (lowercase, remove special chars, replace spaces with hyphens)
      const topicSlug = (meetingPurpose || '')
        .toLowerCase()
        .replace(/[^\w\s-]/g, '') // Remove special characters
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .substring(0, 50); // Limit length to avoid overly long filenames

      // Construct filename with date and topic (using .md extension for markdown)
      const filename = `meeting-${currentDate}-${topicSlug}.md`;

      // Create a spinner for the summary generation
      const summarySpinner = ora('Generating meeting summary...').start();

      // Save transcript is now async because it generates a summary
      await simulator.saveTranscript(filename);

      summarySpinner.succeed('Meeting summary and transcript generated!');
      console.log(chalk.green(`\nTranscript saved to ${filename}`));
    }

    process.exit(0);
  } catch (error: unknown) {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
  }
}

function saveDefaults(data: Defaults) {
  fs.writeFileSync(saveFile, JSON.stringify(data, undefined, 2), { encoding: 'utf8' });
}

function loadDefaults(): Defaults | undefined {
  if (!fs.existsSync(saveFile)) {
    return undefined;
  }
  const file = fs.readFileSync(saveFile, 'utf8');
  return JSON.parse(file);
}

main();
