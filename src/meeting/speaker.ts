import type { Agent } from '../agents/agent.js';
import type { ModeratorAgent } from '../agents/moderator.js';
import type { Message } from '../types.js';
import { createThinkingSpinner, updateSpinnerWithNextSpeaker } from '../ui/spinner.js';
import { debugLog } from '../utils/formatting.js';

/**
 * Select the next speaker based on urgency scores
 *
 * @param agents The agent objects
 * @param conversation The conversation history
 * @param lastSpeakerId The ID of the last speaker (to prevent consecutive speaking)
 * @param moderator The moderator agent
 * @param currentAgendaItem The current agenda item
 * @returns The ID of the next speaker
 */
export async function selectNextSpeaker(
  agents: Record<string, Agent>,
  conversation: Message[],
  lastSpeakerId: string | null,
  moderator: ModeratorAgent,
  currentAgendaItem: string,
  isLastMessageFromUser: boolean,
): Promise<string> {
  // Get list of participating agents (excluding moderator)
  const participantAgentIds = Object.keys(agents).filter((id) => id !== 'moderator');

  // Log meeting phase and last speaker for debugging
  if (lastSpeakerId) {
    debugLog(`Last non-moderator speaker: ${agents[lastSpeakerId].name}`);
  } else {
    debugLog('No previous non-moderator speaker recorded yet');
  }

  // Determine who cannot speak based on last speaker and user input
  let restrictedSpeakerId: string | null = null;

  // Only apply the consecutive speaker restriction when the last message wasn't from a user
  if (!isLastMessageFromUser && lastSpeakerId) {
    restrictedSpeakerId = lastSpeakerId;
    debugLog(`Restricting ${agents[restrictedSpeakerId].name} from speaking consecutively`);
  } else {
    debugLog('No speaker restrictions currently active');
  }

  // Create a tracking object for agent thinking status
  const thinkingStatus: Record<string, string> = {};
  for (const id of participantAgentIds) {
    // If this is the restricted speaker, mark them as "zipped" (can't speak again)
    // Otherwise mark as "thinking" initially
    thinkingStatus[id] = id === restrictedSpeakerId ? 'zipped' : 'thinking';
  }

  // Create a single spinner
  const spinner = createThinkingSpinner(thinkingStatus, agents);
  spinner.start();

  // Collect all urgency calculation promises
  const urgencyScores: Record<string, number> = {};
  const urgencyPromises: Promise<{ agentId: string; urgency: number }>[] = [];

  for (const agentId of participantAgentIds) {
    // Skip urgency calculation for restricted speaker (they can't speak again immediately)
    if (agentId === restrictedSpeakerId) {
      urgencyScores[agentId] = 0; // Assign zero urgency
      continue; // Skip to next agent
    }

    const agent = agents[agentId];
    const promise = agent.calculateUrgency(conversation, currentAgendaItem).then((urgency) => {
      urgencyScores[agentId] = urgency;
      thinkingStatus[agentId] = 'done'; // Mark as done
      spinner.text = `Who's next: ${participantAgentIds
        .map((id) => {
          const agent = agents[id];
          let status: string;
          if (thinkingStatus[id] === 'zipped') {
            status = '🤐'; // Zipper-mouth face for last speaker
          } else if (thinkingStatus[id] === 'thinking') {
            status = '🔄'; // Thinking
          } else {
            status = '✅'; // Finished thinking
          }
          return `${agent.name} ${status}`;
        })
        .join(' | ')}`;
      return { agentId, urgency };
    });
    urgencyPromises.push(promise);
  }

  // Wait for all urgency calculations to complete
  await Promise.all(urgencyPromises);

  // Let moderator choose next speaker, influenced by urgency scores
  // Filter out the restricted speaker (who has zero urgency)
  const eligibleSpeakers = Object.entries(urgencyScores)
    .filter(([agentId, score]) => agentId !== restrictedSpeakerId)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3); // Top 3 most urgent

  let nextSpeaker: string;
  let speakerSelectionReason: string;

  if (Math.random() < 0.7 && eligibleSpeakers.length > 0) {
    // 70% chance to pick from top urgent speakers
    nextSpeaker = eligibleSpeakers[0][0];
    speakerSelectionReason = 'highest urgency score';
  } else {
    // 30% chance to let moderator decide, but ensure we pass restrictedSpeakerId
    // so the moderator knows not to pick them again
    nextSpeaker = await moderator.chooseNextSpeaker(agents, conversation, restrictedSpeakerId);
    speakerSelectionReason = 'moderator selection';
  }

  // Update spinner to show final state with speaker having raised hand
  updateSpinnerWithNextSpeaker(spinner, thinkingStatus, agents, nextSpeaker);

  // Brief pause to see final state
  await new Promise((resolve) => setTimeout(resolve, 800));
  spinner.succeed();

  // Log selection reason only in debug mode
  debugLog(`Selected next speaker: ${agents[nextSpeaker].name} (${speakerSelectionReason})`);

  // Display urgency scores in debug mode
  if (global.isDebugMode) {
    logUrgencyScores(urgencyScores, agents);
  }

  return nextSpeaker;
}

/**
 * Log urgency scores for debugging
 */
function logUrgencyScores(urgencyScores: Record<string, number>, agents: Record<string, Agent>): void {
  console.log('\x1b[90m=== Urgency Scores ===\x1b[0m');

  // Sort by urgency score (highest first)
  const sortedScores = Object.entries(urgencyScores).sort((a, b) => b[1] - a[1]);

  for (const [agentId, score] of sortedScores) {
    const agent = agents[agentId];
    // Display each agent's urgency score with formatting based on how urgent it is
    const scoreColor =
      score >= 4
        ? '\x1b[91m'
        : // redBright
          score >= 3
          ? '\x1b[93m'
          : // yellowBright
            '\x1b[92m'; // greenBright

    console.log(`\x1b[90m${agent.name} [${agent.role}]: \x1b[0m${scoreColor}${score.toFixed(2)}\x1b[0m`);
  }

  console.log('\x1b[90m=====================\x1b[0m');
}
