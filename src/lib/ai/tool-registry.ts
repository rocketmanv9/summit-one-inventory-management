/**
 * Tool Registry — Single source of truth for AI tool definitions,
 * governance, permissions, and execution handlers.
 *
 * Unifies INVENTORY_TOOLS, SERVER_TOOLS, and TOOL_GOVERNANCE into
 * one registry with typed registration, role-based filtering,
 * tenant config overrides, and tagged grouping.
 */

import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import type { ToolGovernance } from './types';
import type { UserRole } from './tool-governance';
import type { ServerToolContext, ServerToolResult } from './server-tools';

// ─── Types ───────────────────────────────────────────────────────────

export type ToolTag =
  | 'analytics'
  | 'dashboard'
  | 'workflow'
  | 'smart'
  | 'crud'
  | 'navigation'
  | 'enrichment'
  | 'apparel'
  | 'search'
  | 'ontology'
  | 'semantic';

export type ToolExecutionMode = 'server' | 'client';

export interface ToolDefinition {
  /** Unique tool name (must match OpenAI function name) */
  name: string;
  /** OpenAI function schema for this tool */
  schema: ChatCompletionTool;
  /** Governance metadata */
  governance: ToolGovernance;
  /** Tags for grouping and filtering */
  tags: ToolTag[];
  /** Whether this tool executes server-side or returns to the client */
  executionMode: ToolExecutionMode;
  /** Server-side execution handler (required if executionMode === 'server') */
  handler?: (params: Record<string, any>, ctx: ServerToolContext) => Promise<ServerToolResult>;
  /** Minimum role required (defaults to 'authenticated') */
  minRole?: UserRole;
}

export interface TenantToolConfig {
  tool_name: string;
  enabled: boolean;
  rate_limit?: number | null;
  config: Record<string, any>;
}

// ─── Registry ────────────────────────────────────────────────────────

class ToolRegistryImpl {
  private tools = new Map<string, ToolDefinition>();

  /**
   * Register a tool definition. Overwrites if already registered.
   */
  register(def: ToolDefinition): void {
    this.tools.set(def.name, def);
  }

  /**
   * Get a tool definition by name.
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all registered tool names.
   */
  names(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get all tool definitions.
   */
  all(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * List tools by tag.
   */
  listByTag(tag: ToolTag): ToolDefinition[] {
    return this.all().filter((t) => t.tags.includes(tag));
  }

  /**
   * Check if a tool is a server-side tool.
   */
  isServerTool(name: string): boolean {
    const def = this.tools.get(name);
    return def?.executionMode === 'server';
  }

  /**
   * Get OpenAI function schemas filtered by user role and tenant config.
   * Admin gets all tools; non-admin gets tools minus admin-only ones.
   * Tenant config can disable specific tools.
   */
  getOpenAITools(
    role: UserRole,
    tenantConfig?: TenantToolConfig[]
  ): ChatCompletionTool[] {
    const configMap = new Map<string, TenantToolConfig>();
    if (tenantConfig) {
      for (const cfg of tenantConfig) {
        configMap.set(cfg.tool_name, cfg);
      }
    }

    const schemas: ChatCompletionTool[] = [];
    for (const def of this.tools.values()) {
      // Role-based filtering
      if (def.minRole === 'admin' && role !== 'admin') continue;

      // Tenant config override
      const cfg = configMap.get(def.name);
      if (cfg && !cfg.enabled) continue;

      schemas.push(def.schema);
    }

    return schemas;
  }

  /**
   * Check if a tool can be executed by the given role.
   */
  canExecute(toolName: string, role: UserRole): boolean {
    const def = this.tools.get(toolName);
    if (!def) return false;
    if (def.minRole === 'admin' && role !== 'admin') return false;
    return true;
  }

  /**
   * Execute a server-side tool by name.
   * Throws if the tool is not registered, not a server tool, or has no handler.
   */
  async execute(
    toolName: string,
    params: Record<string, any>,
    ctx: ServerToolContext
  ): Promise<ServerToolResult> {
    const def = this.tools.get(toolName);
    if (!def) {
      return {
        text: `Unknown tool: ${toolName}`,
        dataDisplay: { displayType: 'metric', label: 'Error', value: 'Unknown tool' },
      };
    }
    if (def.executionMode !== 'server' || !def.handler) {
      return {
        text: `Tool ${toolName} is not a server-side tool`,
        dataDisplay: { displayType: 'metric', label: 'Error', value: 'Not a server tool' },
      };
    }

    const start = Date.now();
    const result = await def.handler(params, ctx);
    result.durationMs = Date.now() - start;
    return result;
  }

  /**
   * Get governance metadata for a tool.
   */
  getGovernance(toolName: string): ToolGovernance | undefined {
    return this.tools.get(toolName)?.governance;
  }

  /**
   * Load tenant-specific tool config from Supabase.
   */
  async loadTenantConfig(
    supabase: any,
    tenantId: string
  ): Promise<TenantToolConfig[]> {
    try {
      const { data } = await supabase
        .schema('inventory')
        .from('ai_tool_config')
        .select('tool_name, enabled, rate_limit, config')
        .eq('tenant_id', tenantId);
      return (data || []) as TenantToolConfig[];
    } catch {
      return [];
    }
  }
}

/** Global singleton tool registry */
export const toolRegistry = new ToolRegistryImpl();
