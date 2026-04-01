import { z } from 'zod';

const toolSchemas = {
  Bash: z.object({
    command: z.string().min(1, 'Command cannot be empty'),
  }),
  Read: z.object({
    file_path: z.string().min(1, 'File path cannot be empty'),
  }),
  Write: z.object({
    file_path: z.string().min(1, 'File path cannot be empty'),
    content: z.string(),
  }),
  Edit: z.object({
    file_path: z.string().min(1, 'File path cannot be empty'),
    old_string: z.string().min(1, 'Old string cannot be empty'),
    new_string: z.string(),
  }),
  Grep: z.object({
    pattern: z.string().min(1, 'Pattern cannot be empty'),
    path: z.string().optional(),
  }),
  Glob: z.object({
    pattern: z.string().min(1, 'Pattern cannot be empty'),
    path: z.string().optional(),
  }),
};

/**
 * Validates the tool input against strict Zod schemas.
 * Returns { valid: true } or { valid: false, error: string }
 */
export function validateToolCallSchema(toolName, toolInput) {
  const schema = toolSchemas[toolName];
  if (!schema) {
    // If we don't have a schema for it, let it pass (e.g. MCPs or other custom tools)
    return { valid: true };
  }

  const result = schema.safeParse(toolInput);
  if (result.success) {
    return { valid: true };
  } else {
    // Format the error nicely
    const errors = (result.error.issues || result.error.errors || [])
      .map((err) => `${err.path.join('.')}: ${err.message}`)
      .join('; ');
    return {
      valid: false,
      error: `Your JSON payload is strictly invalid: [${errors}]. Fix the syntax immediately before proceeding.`,
    };
  }
}
