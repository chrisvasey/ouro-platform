import { join } from "path";
import { readFileSync, existsSync } from "fs";

const PROMPTS_DIR = join(import.meta.dir, "../prompts");

/** Load a prompt file by agent role name. Returns empty string if not found. */
export function loadPrompt(role: string): string {
  const filePath = join(PROMPTS_DIR, `${role}.md`);
  if (!existsSync(filePath)) {
    console.warn(`[prompts] Prompt file not found: ${filePath}`);
    return `You are the ${role} agent for Ouro.`;
  }
  return readFileSync(filePath, "utf-8");
}
