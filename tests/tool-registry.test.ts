/**
 * Tool Registry Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the OpenAI import
vi.mock('openai', () => ({ default: class {} }));

import { toolRegistry } from '@/lib/ai/tool-registry';
import '@/lib/ai/tool-registrations';

describe('ToolRegistry', () => {
  it('should have registered tools from bootstrap', () => {
    const names = toolRegistry.names();
    expect(names.length).toBeGreaterThan(30);
  });

  it('should correctly identify server tools', () => {
    expect(toolRegistry.isServerTool('query_inventory_summary')).toBe(true);
    expect(toolRegistry.isServerTool('query_stock_valuation')).toBe(true);
    expect(toolRegistry.isServerTool('workflow_auto_reorder')).toBe(true);
    expect(toolRegistry.isServerTool('add_vendor')).toBe(false);
    expect(toolRegistry.isServerTool('list_vendors')).toBe(false);
  });

  it('should filter tools by role', () => {
    const adminTools = toolRegistry.getOpenAITools('admin');
    const userTools = toolRegistry.getOpenAITools('authenticated');
    expect(adminTools.length).toBeGreaterThan(userTools.length);
  });

  it('should filter admin-only tools for non-admin users', () => {
    const userTools = toolRegistry.getOpenAITools('authenticated');
    const userToolNames = userTools.map((t) => t.function.name);
    expect(userToolNames).not.toContain('delete_vendor');
    expect(userToolNames).not.toContain('workflow_auto_reorder');
    expect(userToolNames).not.toContain('approve_apparel_order');
  });

  it('should apply tenant config overrides', () => {
    const allTools = toolRegistry.getOpenAITools('admin');
    const disabledTools = toolRegistry.getOpenAITools('admin', [
      { tool_name: 'query_dead_stock', enabled: false, config: {} },
    ]);
    expect(disabledTools.length).toBe(allTools.length - 1);
    const disabledNames = disabledTools.map((t) => t.function.name);
    expect(disabledNames).not.toContain('query_dead_stock');
  });

  it('should list tools by tag', () => {
    const analytics = toolRegistry.listByTag('analytics');
    expect(analytics.length).toBeGreaterThanOrEqual(10);
    for (const tool of analytics) {
      expect(tool.tags).toContain('analytics');
    }
  });

  it('should return governance metadata', () => {
    const gov = toolRegistry.getGovernance('workflow_auto_reorder');
    expect(gov).toBeDefined();
    expect(gov!.riskLevel).toBe('high');
    expect(gov!.requiresConfirmation).toBe(true);
  });

  it('should return OpenAI-compatible tool schemas', () => {
    const tools = toolRegistry.getOpenAITools('admin');
    for (const tool of tools) {
      expect(tool).toHaveProperty('type', 'function');
      expect(tool).toHaveProperty('function');
      expect(tool.function).toHaveProperty('name');
      expect(tool.function).toHaveProperty('parameters');
    }
  });

  it('should check execution permissions', () => {
    expect(toolRegistry.canExecute('list_vendors', 'authenticated')).toBe(true);
    expect(toolRegistry.canExecute('delete_vendor', 'authenticated')).toBe(false);
    expect(toolRegistry.canExecute('delete_vendor', 'admin')).toBe(true);
    expect(toolRegistry.canExecute('nonexistent_tool', 'admin')).toBe(false);
  });
});
