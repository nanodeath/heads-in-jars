#!/usr/bin/env node
import { config } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import chalk from 'chalk';
import figlet from 'figlet';
import enquirer from 'enquirer';
const { Confirm, Input, Select, Form, MultiSelect } = enquirer;
import ora from 'ora';
import logUpdate from 'log-update';
import fs from 'fs';
import path from 'path';

// Load environment variables
config();

// Check for command line arguments
const isValidationMode = process.argv.includes('--validate');
const isDebugMode = process.argv.includes('--debug');

// Check for agenda file argument
const agendaFileArg = process.argv.find(arg => arg.startsWith('--agenda-file='));
const agendaFilePath = agendaFileArg ? agendaFileArg.split('=')[1] : null;

// Set debug mode globally so it can be accessed from any module
global.isDebugMode = isDebugMode;

// Import agent and meeting modules
import { Agent, ModeratorAgent } from './agents.js';
import { MeetingSimulator } from './meeting.js';
import { availablePersonas } from './personas.js';
import { createMessage, sleep, formatDuration, truncateText, containsAny, generateId, debugLog, calculateCost } from './utils.js';

const defaultLowEndModel = 'claude-3-5-haiku-latest';
const defaultHighEndModel = 'claude-3-5-haiku-latest'; // 'claude-3-7-sonnet-latest'

/**
 * Read and parse an agenda file
 * @param {string} filePath - Path to the agenda file
 * @returns {Object} Object containing meetingPurpose and agenda
 */
function readAgendaFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      console.error(chalk.red(`Error: Agenda file not found at ${filePath}`));
      return null;
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');
    const lines = fileContent.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
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
  } catch (error) {
    console.error(chalk.red(`Error reading agenda file: ${error.message}`));
    return null;
  }
}

// Validate all imports
function validateImports() {
  console.log(chalk.cyan('Validating imports...'));
  
  // Validate utility functions
  console.log('✓ utils.js: createMessage, sleep, formatDuration, truncateText, containsAny, generateId');
  
  // Validate agent module
  const agentInstance = new Agent({
    agentId: 'test',
    name: 'Test Agent',
    persona: 'Test persona',
    color: 'blue',
    client: null,
  });
  console.log('✓ agents.js: Agent, ModeratorAgent');
  
  // Validate personas
  console.log(`✓ personas.js: ${Object.keys(availablePersonas).length} personas available`);
  
  // Validate meeting simulator
  console.log('✓ meeting.js: MeetingSimulator');
  
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
async function main() {
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
      const apiKeyPrompt = await new Input({
        name: 'apiKey',
        message: 'Enter your Anthropic API key:',
        validate: (value) => value.length > 0 ? true : 'API key is required'
      }).run();
      
      apiKey = apiKeyPrompt;
    }
    
    // Create Anthropic client
    const client = new Anthropic({
      apiKey: apiKey
    });
    
    // Select user involvement level
    const involvementPrompt = await new Select({
      name: 'involvement',
      message: 'Select your level of involvement in the meeting:',
      choices: [
        { name: 'none', message: 'None - Just observe the meeting' },
        { name: 'low', message: 'Low - Occasional input' },
        { name: 'high', message: 'High - Frequent opportunities to speak' }
      ]
    }).run();
    
    // Select models to use
    const modelsForm = await new Form({
      name: 'models',
      message: 'Select Claude models to use (or press Enter for defaults):',
      choices: [
        { name: 'lowEndModel', message: 'Low-end model (for urgency)', initial: defaultLowEndModel },
        { name: 'highEndModel', message: 'High-end model (for responses)', initial: defaultHighEndModel }
      ]
    }).run();
    
    // Get meeting purpose and agenda items (either from file or user input)
    let meetingPurpose;
    let agenda = [];
    
    // If an agenda file was provided, read it
    if (agendaFilePath) {
      debugLog(`Reading agenda from file: ${agendaFilePath}`);
      const fileData = readAgendaFile(agendaFilePath);
      
      if (fileData) {
        meetingPurpose = fileData.meetingPurpose;
        agenda = fileData.agenda;
        
        console.log(chalk.green(`Loaded meeting purpose: ${meetingPurpose}`));
        console.log(chalk.green(`Loaded ${agenda.length} agenda items from file`));
      } else {
        console.log(chalk.red('Failed to load agenda from file. Falling back to manual input.'));
        // Continue with manual input below
      }
    }
    
    // If we didn't get meeting purpose from file, ask the user
    if (!meetingPurpose) {
      meetingPurpose = await new Input({
        name: 'purpose',
        message: 'Enter a brief description of the meeting purpose:',
        initial: 'Weekly project status and planning'
      }).run();
    }
    
    // If we didn't get agenda from file, ask the user
    if (agenda.length === 0) {
      console.log(chalk.yellow('\nEnter agenda items (leave blank when done):'));
      
      let itemNumber = 1;
      
      // Set initial agenda item suggestion
      let initialValue = 'Project status updates';
      
      while (true) {
        const agendaItem = await new Input({
          name: 'item',
          message: `Agenda item #${itemNumber}:`,
          initial: initialValue,
          hint: itemNumber === 1 ? '(press Enter to submit, leave blank when finished)' : '(leave blank when finished)'
        }).run();
        
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
    
    const spinner = ora('Setting up the meeting...').start();
    
    const simulator = new MeetingSimulator({
      client,
      agenda,
      userInvolvement: involvementPrompt,
      lowEndModel: modelsForm.lowEndModel,
      highEndModel: modelsForm.highEndModel,
      meetingPurpose
    });
    
    // Wait for initialization to complete
    await simulator.initialize();
    spinner.succeed('Meeting setup complete!');
    
    // Display meeting information
    console.log(chalk.green('\n=== Meeting Information ==='));
    console.log(chalk.white(`Topic: ${meetingPurpose}`));
    console.log(chalk.white(`Agenda: ${agenda.join(', ')}`));
    console.log(chalk.white(`Participants: ${Object.values(simulator.agents).map(a => a.name).join(', ')}`));
    
    // Start the meeting
    console.log(chalk.green('\n=== Starting Meeting ===\n'));
    await simulator.introduceParticipants();
    await simulator.runMeeting();
    
    // Meeting conclusion
    console.log(chalk.green('\n=== Meeting Concluded ===\n'));
    
    // Ask if user wants to save the transcript
    const saveTranscript = await new Confirm({
      name: 'save',
      message: 'Save meeting transcript?',
      initial: true
    }).run();
    
    if (saveTranscript) {
      const filename = `meeting-transcript-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      simulator.saveTranscript(filename);
      console.log(chalk.green(`Transcript saved to ${filename}`));
    }
    
    process.exit(0);
  } catch (error) {
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

main();