/**
 * Meeting transcript utilities
 */

import fs from 'fs';
import { Message } from '../types.js';
import { debugLog } from '../utils/formatting.js';
import { ModeratorAgent } from '../agents/moderator.js';
import { Agent } from '../agents/agent.js';

/**
 * Generate and save a meeting transcript
 */
export async function saveTranscript(
  filename: string,
  conversation: Message[],
  moderator: ModeratorAgent,
  agents: Record<string, Agent>,
  meetingPurpose: string,
  agenda: string[]
): Promise<void> {
  if (!moderator) {
    throw new Error("Moderator not initialized");
  }
  
  // First, generate a meeting summary using the moderator
  let summary = await moderator.generateMeetingSummary(conversation);
  
  // Fix heading hierarchy in the summary
  summary = normalizeHeadings(summary);
  
  // Format the meeting date
  const meetingDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric'
  });
  
  // Create the markdown content
  let markdown = '';
  
  // Add title and metadata
  markdown += `# Meeting: ${meetingPurpose}\n\n`;
  markdown += `**Date:** ${meetingDate}\n\n`;
  
  // Add participant list
  markdown += `## Participants\n\n`;
  for (const [agentId, agent] of Object.entries(agents)) {
    if (agentId !== 'moderator') {
      markdown += `- **${agent.name}** (${agent.role})\n`;
    }
  }
  markdown += `- **${agents['moderator'].name}** (${agents['moderator'].role})\n\n`;
  
  // Add agenda
  markdown += `## Agenda\n\n`;
  agenda.forEach((item, i) => {
    markdown += `${i+1}. ${item}\n`;
  });
  markdown += '\n';
  
  // Add summary with fixed heading hierarchy
  markdown += `## Meeting Summary\n\n${summary}\n\n`;
  
  // Find the conclusion message if present (from meeting phase 'conclusion')
  let conclusionMessage = '';
  let foundConclusionMessage = false;
  
  // Look for the last message from the moderator which should be the conclusion
  for (let i = conversation.length - 1; i >= 0; i--) {
    const msg = conversation[i];
    if (msg.agentId === 'moderator') {
      conclusionMessage = `## Conclusion\n\n${msg.content}\n\n`;
      foundConclusionMessage = true;
      break;
    }
  }
  
  // Add the conclusion if available
  if (foundConclusionMessage) {
    markdown += conclusionMessage;
  }
  
  // Add transcript
  markdown += `## Transcript\n\n`;
  conversation.forEach(msg => {
    if (msg.role === 'assistant') {
      // Format participant messages
      markdown += `### ${msg.agentName} [${msg.agentRole}]:\n\n`;
      markdown += `${msg.content}\n\n`;
    } else if (msg.role === 'user') {
      // Format user messages
      markdown += `### User:\n\n${msg.content}\n\n`;
    }
  });
  
  // Write to file
  fs.writeFileSync(filename, markdown);
  
  // Log success message (for debugging)
  debugLog(`Saved transcript to ${filename}`);
}

/**
 * Normalize headings to ensure proper hierarchy
 */
function normalizeHeadings(summary: string): string {
  // Remove any top-level headings that duplicate "Meeting Summary"
  let normalized = summary.replace(/^# Meeting Summary.*$/m, '');
  
  // Make sure all headings in the summary use proper hierarchy
  // First, normalize all headings to their appropriate level under "Meeting Summary"
  // Convert any h1 headings to h2
  normalized = normalized.replace(/^# /gm, '## ');
  
  // Convert any h3 headings to h2 for consistency (h3 is too deep for main section headings)
  normalized = normalized.replace(/^### /gm, '## ');
  
  // Make sure any h4+ headings are at most h3 level
  normalized = normalized.replace(/^#{4,6} /gm, '### ');
  
  return normalized;
}