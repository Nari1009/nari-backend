require('dotenv').config();
const { createOpenAIProvider } = require('../src/services/ai/providers/openaiProvider');
const { validateProviderOutput } = require('../src/services/ai/contract');

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run the DEV OpenAI harness in production.');
  process.exit(1);
}
if (process.env.OPENAI_ENABLED !== 'true' || !process.env.OPENAI_API_KEY) {
  console.error('Set OPENAI_ENABLED=true and OPENAI_API_KEY in the DEV environment.');
  process.exit(1);
}

const provider = createOpenAIProvider();
const cases = [
  'Mi piel se pone muy grasosa durante el día y a veces me salen granitos. No sé por dónde empezar.',
  'No sé qué comprar para una rutina sencilla.',
  '¿Cuál es la capital de Francia?',
];

(async () => {
  for (const message of cases) {
    try {
      const raw = await provider.interpretConversation({ message, history: [] });
      const result = validateProviderOutput(raw);
      console.log(JSON.stringify({ scope: result.scope, intent: result.intent, mode: result.mode, message: result.message, profile: result.profile }));
    } catch (error) {
      console.error(JSON.stringify({ code: error.code || 'AI_UNAVAILABLE', error: 'DEV OpenAI test case failed safely.' }));
      process.exitCode = 1;
    }
  }
})().catch(() => {
  console.error(JSON.stringify({ code: 'AI_UNAVAILABLE', error: 'DEV OpenAI harness failed safely.' }));
  process.exitCode = 1;
});
