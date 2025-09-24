import { Hono } from 'hono';
import type { Env } from '../index';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

const chatTestRouter = new Hono<{ Bindings: Env }>();

/**
 * Simple test endpoint without tools to verify Claude connectivity
 */
chatTestRouter.post('/simple', async (c) => {
  const requestId = crypto.randomUUID().substring(0, 8);
  console.log(`[Test:${requestId}] Testing Claude without tools`);

  try {
    const body = await c.req.json();
    const message = body.message || 'Hello, can you respond?';

    // Initialize Claude WITHOUT tools
    const llm = new ChatAnthropic({
      apiKey: c.env.ANTHROPIC_API_KEY,
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0.2,
      maxTokens: 500,
      maxRetries: 1,
    });

    console.log(`[Test:${requestId}] Invoking Claude with simple message: "${message}"`);

    // Simple invocation without tools
    const response = await llm.invoke([
      new SystemMessage('You are a helpful assistant. Respond briefly.'),
      new HumanMessage(message)
    ]);

    console.log(`[Test:${requestId}] Success! Response received`);

    return c.json({
      success: true,
      message: typeof response.content === 'string' ? response.content : 'Response received',
      requestId,
      withTools: false
    });

  } catch (error) {
    console.error(`[Test:${requestId}] Error:`, error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if it's actually a 529
    if (errorMessage.includes('529') || errorMessage.includes('overloaded')) {
      return c.json({
        success: false,
        error: 'Claude API is actually overloaded (529)',
        requestId,
        withTools: false
      }, 503);
    }

    return c.json({
      success: false,
      error: errorMessage,
      errorDetails: error instanceof Error ? {
        name: error.name,
        stack: error.stack?.split('\n').slice(0, 3)
      } : null,
      requestId,
      withTools: false
    }, 500);
  }
});

/**
 * Test endpoint WITH tools to compare
 */
chatTestRouter.post('/with-tools', async (c) => {
  const requestId = crypto.randomUUID().substring(0, 8);
  console.log(`[Test:${requestId}] Testing Claude WITH tools`);

  try {
    const body = await c.req.json();
    const message = body.message || 'Hello, can you respond?';

    // Initialize Claude
    const llm = new ChatAnthropic({
      apiKey: c.env.ANTHROPIC_API_KEY,
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0.2,
      maxTokens: 500,
      maxRetries: 1,
    });

    // Create a simple dummy tool
    const dummyTool = {
      name: 'dummy_tool',
      description: 'A dummy tool for testing',
      schema: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Any input' }
        },
        required: ['input']
      }
    };

    console.log(`[Test:${requestId}] Binding 1 dummy tool to Claude`);

    // Try to bind tools
    const modelWithTools = llm.bindTools([dummyTool]);

    console.log(`[Test:${requestId}] Invoking Claude with tools and message: "${message}"`);

    // Invocation with tools
    const response = await modelWithTools.invoke([
      new SystemMessage('You are a helpful assistant. You have access to tools but don\'t need to use them. Respond briefly.'),
      new HumanMessage(message)
    ]);

    console.log(`[Test:${requestId}] Success! Response received with tools`);

    return c.json({
      success: true,
      message: typeof response.content === 'string' ? response.content : 'Response received',
      hadToolCalls: !!(response.tool_calls && response.tool_calls.length > 0),
      requestId,
      withTools: true
    });

  } catch (error) {
    console.error(`[Test:${requestId}] Error with tools:`, error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if it's actually a 529
    if (errorMessage.includes('529') || errorMessage.includes('overloaded')) {
      return c.json({
        success: false,
        error: 'Claude API is actually overloaded (529) even with tools',
        requestId,
        withTools: true
      }, 503);
    }

    return c.json({
      success: false,
      error: errorMessage,
      errorDetails: error instanceof Error ? {
        name: error.name,
        stack: error.stack?.split('\n').slice(0, 3)
      } : null,
      requestId,
      withTools: true
    }, 500);
  }
});

export { chatTestRouter };