# AI Meeting Simulator

This Node.js application simulates meetings with AI agents using the Anthropic Claude API. It creates a dynamic, interactive meeting environment with multiple AI personas and a moderator.

## Features

- Multiple AI agents, each with unique personas and roles
- A moderator agent that drives the meeting based on an agenda
- Dynamic speaker selection based on urgency ratings
- User participation at different involvement levels
- Two-tiered model approach (low-end for urgency, high-end for responses)
- Color-coded terminal output
- Meeting transcript export

## Prerequisites

- Node.js 16+
- An Anthropic API key

## Installation

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Copy `.env.example` to `.env` and add your Anthropic API key:
   ```
   cp .env.example .env
   ```
4. Update `.env` with your API key:
   ```
   ANTHROPIC_API_KEY=your_api_key_here
   ```

## Usage

Start the application:

```
npm start
```

You can also specify an agenda file:

```
npm start -- --agenda-file=sample-agenda.txt
```

The agenda file should be formatted as:
- First line: Meeting purpose/topic
- Subsequent lines: Agenda items (one per line)
- Empty lines are ignored

Follow the interactive prompts to:
1. Select your involvement level
2. Choose models for low and high-end operations
3. Enter a meeting purpose and agenda items (if not loaded from file)
4. Participate in the meeting

During the meeting:
- The moderator will guide the discussion through agenda items
- AI agents will contribute based on their personas and urgency to speak
- You can participate at your chosen involvement level
- Type "exit", "quit", or "end meeting" to end the meeting early

## Configuration

### Command-line Options
- `--validate`: Run in validation mode (checks imports and exits)
- `--debug`: Run in debug mode (shows additional debug information)
- `--agenda-file=path/to/file.txt`: Load meeting purpose and agenda from a file

### Customization
You can customize:
- User involvement level (none, low, high)
- Models used for low-end and high-end operations
- Meeting agenda items
- Meeting purpose

## Agent Personas

The simulator includes the following personas:
- Junior Developer
- Senior Developer
- Product Manager
- Development Manager
- QA Tester
- System Architect
- DevOps Engineer
- UX Designer

## License

MIT