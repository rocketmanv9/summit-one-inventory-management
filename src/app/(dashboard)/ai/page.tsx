'use client';

import { useRef, useEffect } from 'react';
import {
  Bot,
  Send,
  Loader2,
  ExternalLink,
  Check,
  XCircle,
  Clock,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { AddVendorModal } from '@/components/modals/AddVendorModal';
import { useAiChat } from '@/lib/ai/useAiChat';
import type { Message, ChatAction } from '@/lib/ai/types';

export default function AIWorkspacePage() {
  const chat = useAiChat({ mode: 'workspace' });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chat.sendMessage();
    }
  };

  const proposedActions = chat.actions.filter((a) => a.status === 'proposed');
  const actionHistory = chat.actions.filter(
    (a) => a.status === 'completed' || a.status === 'failed'
  );

  return (
    <AppShell>
      {/* Vendor Modal */}
      <AddVendorModal
        open={chat.vendorModal.open}
        onClose={chat.vendorModal.onClose}
        onSuccess={chat.vendorModal.onSuccess}
        initialName={chat.vendorModal.initialName}
      />

      <div className="flex h-[calc(100vh-7rem)] gap-4">
        {/* ── Left Column: Chat ──────────────────────────────── */}
        <div className="flex flex-col flex-[3] min-w-0 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-4 border-b bg-gradient-to-r from-blue-600 to-blue-700 text-white">
            <Bot className="w-6 h-6" />
            <div>
              <h1 className="text-lg font-semibold">AI Workspace</h1>
              <p className="text-sm text-blue-100">
                Full-powered inventory assistant
              </p>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {chat.messages.map((message) => (
              <div key={message.id}>
                <WorkspaceMessageBubble
                  message={message}
                  onNavigate={chat.navigate}
                />

                {/* Inline select options */}
                {message.selectOptions &&
                  message.selectOptions.length > 0 &&
                  chat.activeFlow &&
                  chat.activeFlow.action.steps[chat.activeFlow.currentStepIndex]
                    ?.type === 'select' && (
                    <div className="mt-2 ml-1 flex flex-wrap gap-1.5">
                      {message.selectOptions.slice(0, 10).map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => chat.handleSelectOption(opt.value)}
                          disabled={chat.isLoading}
                          className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-full hover:bg-blue-50 hover:border-blue-400 transition-colors disabled:opacity-50 text-gray-700"
                        >
                          {opt.label}
                        </button>
                      ))}
                      {message.selectOptions.length > 10 && (
                        <span className="px-2 py-1 text-sm text-gray-400">
                          +{message.selectOptions.length - 10} more — type to
                          search
                        </span>
                      )}
                    </div>
                  )}
              </div>
            ))}

            {chat.isLoading &&
              chat.messages[chat.messages.length - 1]?.status !==
                'executing' && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-lg px-4 py-3">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
                  </div>
                </div>
              )}

            <div ref={messagesEndRef} />
          </div>

          {/* Active flow indicator */}
          {chat.activeFlow && (
            <div className="px-6 py-2 bg-blue-50 border-t border-blue-100 flex items-center justify-between">
              <span className="text-sm text-blue-600">
                {chat.activeFlow.action.description} — step{' '}
                {Math.min(
                  chat.activeFlow.currentStepIndex + 1,
                  chat.activeFlow.action.steps.length
                )}{' '}
                of {chat.activeFlow.action.steps.length}
              </span>
              <button
                onClick={chat.cancelFlow}
                className="text-sm text-red-500 hover:text-red-700"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Input */}
          <div className="p-4 border-t">
            <div className="flex gap-3">
              <input
                ref={inputRef}
                type="text"
                value={chat.input}
                onChange={(e) => chat.setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  chat.activeFlow
                    ? 'Type your answer...'
                    : 'Ask me anything about your inventory...'
                }
                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                disabled={chat.isLoading}
              />
              <button
                onClick={() => chat.sendMessage()}
                disabled={!chat.input.trim() || chat.isLoading}
                className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Send message"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* ── Right Column: Actions Panel ────────────────────── */}
        <div className="flex flex-col flex-[2] min-w-[320px] max-w-[440px] gap-4">
          {/* Proposed Actions */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex-shrink-0">
            <div className="px-4 py-3 border-b bg-gray-50">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-500" />
                Proposed Actions ({proposedActions.length})
              </h2>
            </div>
            <div className="p-3 max-h-[280px] overflow-y-auto">
              {proposedActions.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">
                  No proposed actions
                </p>
              ) : (
                <div className="space-y-2">
                  {proposedActions.length > 1 && (
                    <button
                      onClick={() =>
                        proposedActions.forEach((a) =>
                          chat.confirmAction(a.id)
                        )
                      }
                      className="w-full px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors mb-1"
                    >
                      Confirm All
                    </button>
                  )}
                  {proposedActions.map((action) => (
                    <ProposedActionCard
                      key={action.id}
                      action={action}
                      onConfirm={() => chat.confirmAction(action.id)}
                      onCancel={() => chat.cancelAction(action.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Action History */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex-1 min-h-0">
            <div className="px-4 py-3 border-b bg-gray-50">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                Action History
              </h2>
            </div>
            <div className="p-3 overflow-y-auto h-full">
              {actionHistory.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">
                  No action history yet
                </p>
              ) : (
                <div className="space-y-1.5">
                  {actionHistory.map((action) => (
                    <HistoryActionRow key={action.id} action={action} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Saved Prompts (scaffold) */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex-shrink-0">
            <div className="px-4 py-3 border-b bg-gray-50">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                Saved Prompts
              </h2>
            </div>
            <div className="p-4">
              <p className="text-sm text-gray-400 text-center">Coming soon</p>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function WorkspaceMessageBubble({
  message,
  onNavigate,
}: {
  message: Message;
  onNavigate: (path: string) => void;
}) {
  return (
    <div
      className={`flex ${
        message.role === 'user' ? 'justify-end' : 'justify-start'
      }`}
    >
      <div
        className={`max-w-[75%] rounded-lg px-4 py-3 ${
          message.role === 'user'
            ? 'bg-blue-600 text-white'
            : message.status === 'error'
              ? 'bg-red-50 text-red-900 border border-red-200'
              : message.status === 'success'
                ? 'bg-green-50 text-green-900 border border-green-200'
                : 'bg-gray-100 text-gray-900'
        }`}
      >
        {message.status === 'executing' ? (
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">{message.content}</span>
          </div>
        ) : (
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {message.content}
          </div>
        )}

        {message.navigateTo && message.status !== 'executing' && (
          <button
            onClick={() => onNavigate(message.navigateTo!)}
            className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 underline"
          >
            <ExternalLink className="w-3 h-3" />
            Go to page
          </button>
        )}

        <div
          className={`text-xs mt-1 ${
            message.role === 'user' ? 'text-blue-100' : 'text-gray-400'
          }`}
        >
          {message.timestamp.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
    </div>
  );
}

function ProposedActionCard({
  action,
  onConfirm,
  onCancel,
}: {
  action: ChatAction;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="border rounded-lg p-3 bg-blue-50 border-blue-200">
      <div className="font-medium text-sm text-gray-900">{action.title}</div>
      <div className="text-xs text-gray-600 mt-1">{action.summary}</div>
      <div className="flex gap-2 mt-2">
        <button
          onClick={onConfirm}
          className="flex items-center gap-1 px-3 py-1 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          <Check className="w-3 h-3" />
          Confirm
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1 px-3 py-1 text-xs bg-white text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
        >
          <XCircle className="w-3 h-3" />
          Cancel
        </button>
      </div>
    </div>
  );
}

function HistoryActionRow({ action }: { action: ChatAction }) {
  const isSuccess = action.status === 'completed';
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-gray-50 border border-gray-100">
      {isSuccess ? (
        <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
      ) : (
        <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">
          {action.title}
        </div>
        <div className="text-xs text-gray-500 truncate">
          {action.result?.message || action.summary}
        </div>
      </div>
      <span className="text-xs text-gray-400 flex-shrink-0">
        {action.createdAt.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
    </div>
  );
}
