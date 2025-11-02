import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * Convert MCP tool definitions to LangChain DynamicStructuredTool instances
 * This ensures compatibility with LangChain's ReAct agent
 */
export function convertMCPToolsToLangChain(mcpTools: any[], sessionToken: string): DynamicStructuredTool[] {
  console.log(`[MCPConverter] Converting ${mcpTools.length} MCP tools to LangChain format`);

  // Check if tools are already LangChain tools (have _call method)
  if (mcpTools.length > 0 && mcpTools[0]._call) {
    console.log(`[MCPConverter] Tools are already in LangChain format`);
    return mcpTools as DynamicStructuredTool[];
  }

  return mcpTools.map(tool => {
    console.log(`[MCPConverter] Converting tool: ${tool.name}`);
    console.log(`[MCPConverter] Tool properties:`, Object.keys(tool));

    // Convert MCP inputSchema to Zod schema
    const zodSchema = convertJsonSchemaToZod((tool.schema ?? tool.inputSchema) ?? {});

    const langchainTool = new DynamicStructuredTool({
      description: tool.description ?? 'No description available',
      func: async (input: any) => {
        console.log(`[MCPTool:${tool.name}] Executing with input:`, input);

        // If the tool has a direct func property, use it
        if (typeof tool.func === 'function') {
          return await tool.func(input);
        }

        // If it has call or invoke methods (from MCP adapter)
        if (typeof tool.call === 'function') {
          return await tool.call(input);
        }
        if (typeof tool.invoke === 'function') {
          return await tool.invoke(input);
        }
        if (typeof tool._call === 'function') {
          return await tool._call(input);
        }

        // Otherwise, throw an error
        throw new Error(`Tool ${tool.name} has no callable function. Available methods: ${Object.keys(tool).join(', ')}`);
      },
      name: tool.name,
      returnDirect: false,
      schema: zodSchema,
      verbose: false
    });

    console.log(`[MCPConverter] Created LangChain tool: ${tool.name}`);
    return langchainTool;
  });
}

/**
 * Convert JSON Schema to Zod schema
 * This is a simplified converter that handles common cases
 */
function convertJsonSchemaToZod(jsonSchema: any): z.ZodSchema {
  if (!jsonSchema?.type) {
    return z.object({}).passthrough(); // Allow any object
  }

  if (jsonSchema.type === 'object') {
    const shape: Record<string, z.ZodSchema> = {};

    if (jsonSchema.properties) {
      for (const [key, propSchema] of Object.entries(jsonSchema.properties)) {
        let zodType = convertPropertyToZod(propSchema as any);

        // Check if property is required
        if (!jsonSchema.required?.includes(key)) {
          zodType = zodType.optional();
        }

        shape[key] = zodType;
      }
    }

    // If additionalProperties is true, use passthrough
    if (jsonSchema.additionalProperties) {
      return z.object(shape).passthrough();
    }

    return z.object(shape);
  }

  return z.any(); // Fallback for non-object types
}

/**
 * Convert a single JSON Schema property to Zod
 */
function convertPropertyToZod(propSchema: any): z.ZodSchema {
  if (!propSchema?.type) {
    return z.any();
  }

  switch (propSchema.type) {
    case 'array':
      if (propSchema.items) {
        return z.array(convertPropertyToZod(propSchema.items));
      }
      return z.array(z.any());

    case 'boolean':
      return z.boolean();
    case 'integer':

    case 'number':
      let numberSchema = z.number();
      if (propSchema.type === 'integer') {
        numberSchema = numberSchema.int();
      }
      if (propSchema.minimum !== undefined) {
        numberSchema = numberSchema.min(propSchema.minimum);
      }
      if (propSchema.maximum !== undefined) {
        numberSchema = numberSchema.max(propSchema.maximum);
      }
      if (propSchema.description) {
        numberSchema = numberSchema.describe(propSchema.description);
      }
      return numberSchema;

    case 'object':
      return convertJsonSchemaToZod(propSchema);

    case 'string':
      let stringSchema = z.string();
      if (propSchema.minLength) {
        stringSchema = stringSchema.min(propSchema.minLength);
      }
      if (propSchema.maxLength) {
        stringSchema = stringSchema.max(propSchema.maxLength);
      }
      if (propSchema.pattern) {
        stringSchema = stringSchema.regex(new RegExp(propSchema.pattern));
      }
      if (propSchema.enum) {
        // Create enum schema
        return z.enum(propSchema.enum as [string, ...string[]]);
      }
      if (propSchema.description) {
        stringSchema = stringSchema.describe(propSchema.description);
      }
      return stringSchema;

    default:
      return z.any();
  }
}