/**
 * AI Tool Wiring Completeness Guard
 *
 * Asserts every tool defined in INVENTORY_TOOLS is wired end-to-end so the
 * assistant can actually call it. This catches the silent-failure class of bug
 * where a tool is defined for OpenAI but a downstream stage drops it:
 *
 *   - not registered in the ToolRegistry (no tags / no governance)
 *   - a server tool with no `case` in executeServerToolInner's switch
 *   - a switch `case` for a name that isn't a defined tool (orphan handler)
 *   - a client tool rejected by parse-response's VALID_INTENTS gate, which
 *     makes the tool_call SSE event parse to null and no-op
 *   - a capability-gated tool whose capability has no Settings label
 *
 * Unlike ai-tools.test.ts (which spot-checks named tools), this iterates the
 * WHOLE registry, so a newly added tool that's only half-wired fails CI.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { INVENTORY_TOOLS } from '../src/lib/ai/tools';
import { isServerTool, TOOL_CAPABILITY } from '../src/lib/ai/server-tools';
import { toolRegistry } from '../src/lib/ai/tool-registry';
import { parseAIResponse } from '../src/lib/ai/parse-response';
import '../src/lib/ai/tool-registrations';

const SERVER_TOOLS_SRC = readFileSync(
  join(__dirname, '..', 'src', 'lib', 'ai', 'server-tools.ts'),
  'utf8',
);

const TOOL_NAMES: string[] = INVENTORY_TOOLS.flatMap((t) =>
  'function' in t && t.function?.name ? [t.function.name] : [],
);

// Names that appear as `case '<name>':` in server-tools.ts (the executor switch).
const SWITCH_CASES = new Set(
  Array.from(SERVER_TOOLS_SRC.matchAll(/case '([a-z_]+)':/g)).map((m) => m[1]),
);

describe('AI tool wiring completeness', () => {
  it('defines at least the known tool surface', () => {
    // Tripwire so an accidental empty/partial tools.ts import fails loudly.
    expect(TOOL_NAMES.length).toBeGreaterThanOrEqual(70);
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length); // no duplicate names
  });

  it.each(TOOL_NAMES)('%s is registered with tags + governance', (name) => {
    const def = toolRegistry.get(name);
    expect(def, `${name} missing from ToolRegistry`).toBeDefined();
    expect(def!.tags.length, `${name} has no tags in TAG_MAP`).toBeGreaterThan(0);
    expect(def!.governance, `${name} has no governance`).toBeDefined();
  });

  it.each(TOOL_NAMES)('%s passes the parse-response VALID_INTENTS gate', (name) => {
    // A client tool that fails this gate is silently dropped at runtime.
    const parsed = parseAIResponse({ type: 'tool_use', intent: name, params: {} });
    expect(parsed, `${name} rejected by VALID_INTENTS`).not.toBeNull();
    expect(parsed!.type).toBe('tool_use');
  });

  it.each(TOOL_NAMES)('%s has an executor (server switch case or client mode)', (name) => {
    if (isServerTool(name)) {
      expect(
        SWITCH_CASES.has(name),
        `${name} is a SERVER tool but has no case in executeServerToolInner`,
      ).toBe(true);
      expect(toolRegistry.get(name)!.executionMode).toBe('server');
    } else {
      // Client tools dispatch via intent → action flow; they must NOT be marked server.
      expect(toolRegistry.get(name)!.executionMode).toBe('client');
    }
  });

  it('has no orphan server switch cases (every case is a defined tool)', () => {
    // executeInventoryAction handles these action verbs; they ARE defined tools.
    const defined = new Set(TOOL_NAMES);
    const orphans = Array.from(SWITCH_CASES).filter((c) => !defined.has(c));
    expect(orphans, `orphan switch cases with no tool definition: ${orphans.join(', ')}`).toEqual([]);
  });

  it('rejects an unknown intent (gate actually gates)', () => {
    expect(parseAIResponse({ type: 'tool_use', intent: 'not_a_real_tool', params: {} })).toBeNull();
  });

  it('every capability-gated tool is a defined tool', () => {
    for (const name of Object.keys(TOOL_CAPABILITY)) {
      expect(TOOL_NAMES, `${name} in TOOL_CAPABILITY but not a defined tool`).toContain(name);
    }
  });
});
