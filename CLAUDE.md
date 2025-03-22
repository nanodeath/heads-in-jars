# GenAI Meetings Agent Guide

## Commands
- Run app: `npm start`
- Run with agenda file: `npm start -- --agenda-file=path/to/file.txt`
- Run in debug mode: `npm start -- --debug`
- Validate code: `npm run validate`
- Direct validation: `node index.js --validate`
- Run Python version: `python meetings.py`
- Set API key in .env: `ANTHROPIC_API_KEY=your_key_here`

## Code Style Guidelines
- **Format**: ES Modules with import/export syntax
- **Naming**: camelCase for variables/functions, PascalCase for classes
- **Typing**: JSDoc comments for parameter typing
- **Error Handling**: try/catch with specific error logging
- **Documentation**: JSDoc style comments for all functions/classes
- **Imports**: Group imports by external/internal, sort alphabetically
- **UI**: Use chalk for terminal colors, maintain consistent formatting
- **State Management**: Prefer class instances for stateful components
- **API Client**: Initialize once and reuse the Anthropic client
- **Async**: Use async/await for asynchronous operations