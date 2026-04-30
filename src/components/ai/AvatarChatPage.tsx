'use client';

/**
 * AvatarChatPage — Full-page avatar chat layout for the /ai workspace.
 *
 * Layout:
 * ┌──────────────────────────────────────────────┐
 * │          Avatar Video (40% height)           │
 * │    [Isabelle Martinez]  [Speaking...]  [🔇]      │
 * ├──────────────────────────────────────────────┤
 * │  Chat Messages (60%)  │  Actions Panel       │
 * │  [flex-3]             │  [flex-2, max 440px] │
 * │                       │  Proposed / History  │
 * │  [Input bar]          │                      │
 * └──────────────────────────────────────────────┘
 */

import { useRef, useEffect, useCallback } from 'react';
import {
  Send,
  Loader2,
  ExternalLink,
  Check,
  XCircle,
  Clock,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  VolumeX,
  Volume2,
} from 'lucide-react';
import { useAvatarState } from '@/lib/ai/avatar-store';
import { useAiChat } from '@/lib/ai/useAiChat';
import { useTts } from '@/lib/ai/tts';
import { AvatarVideo } from './AvatarVideo';
import { AiDataRenderer } from './AiDataRenderer';
import { AddVendorModal } from '@/components/modals/AddVendorModal';
import type { Message, ChatAction } from '@/lib/ai/types';

export function AvatarChatPage() {
  const { status, ttsMuted, setStatus, toggleMute } = useAvatarState();

  const tts = useTts({
    muted: ttsMuted,
    onStart: () => setStatus('talking'),
    onEnd: () => setStatus('idle'),
  });

  const onAssistantMessage = useCallback(
    (text: string) => {
      setStatus('thinking');
      tts.speak(text);
    },
    [setStatus, tts]
  );

  const chat = useAiChat({
    mode: 'workspace',
    onAssistantMessage,
  });

  // Sync thinking state from chat hook
  useEffect(() => {
    if (chat.isThinking) {
      setStatus('thinking');
    }
  }, [chat.isThinking, setStatus]);

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

  const statusLabel =
    status === 'talking'
      ? 'Speaking...'
      : status === 'thinking'
        ? 'Thinking...'
        : 'Online';

  return (
    <>
      {/* Vendor Modal */}
      <AddVendorModal
        open={chat.vendorModal.open}
        onClose={chat.vendorModal.onClose}
        onSuccess={chat.vendorModal.onSuccess}
        initialName={chat.vendorModal.initialName}
      />

      <div className="flex flex-col h-[calc(100vh-7rem)]">
        {/* ── Avatar Video Section (40%) ──────────────────────── */}
        <div className="relative flex-shrink-0" style={{ height: '40%' }}>
          <div className="h-full p-4 pb-0">
            <AvatarVideo status={status} />
          </div>

          {/* Name plate overlay */}
          <div className="absolute bottom-2 left-8 flex items-center gap-3">
            <div className="bg-black/60 backdrop-blur-sm rounded-lg px-4 py-2 flex items-center gap-3">
              <img
                src="/avatar/avatar.svg"
                alt="Isabelle"
                className="w-8 h-8 rounded-full border border-teal-400/50"
              />
              <div>
                <div className="text-white text-sm font-semibold">Isabelle Martinez</div>
                <div className={`text-xs ${
                  status === 'talking' ? 'text-teal-300' :
                  status === 'thinking' ? 'text-amber-300' :
                  'text-gray-300'
                }`}>
                  {statusLabel}
                </div>
              </div>
            </div>
          </div>

          {/* Mute toggle */}
          <div className="absolute bottom-2 right-8">
            <button
              onClick={toggleMute}
              className="bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 text-white hover:bg-black/80 transition-colors flex items-center gap-2"
              aria-label={ttsMuted ? 'Unmute' : 'Mute'}
            >
              {ttsMuted ? (
                <VolumeX className="w-4 h-4 text-red-400" />
              ) : (
                <Volume2 className="w-4 h-4 text-teal-300" />
              )}
              <span className="text-xs">{ttsMuted ? 'Muted' : 'Audio on'}</span>
            </button>
          </div>
        </div>

        {/* ── Bottom Section: Chat + Actions (60%) ────────────── */}
        <div className="flex flex-1 min-h-0 gap-4 p-4 pt-2">
          {/* ── Chat Column ──────────────────────────────── */}
          <div className="flex flex-col flex-[3] min-w-0 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {chat.messages.map((message) => (
                <div key={message.id}>
                  <ChatMessageBubble
                    message={message}
                    onNavigate={chat.navigate}
                  />

                  {message.dataDisplay && (
                    <div className="max-w-[75%]">
                      <AiDataRenderer data={message.dataDisplay} />
                    </div>
                  )}

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
                            +{message.selectOptions.length - 10} more — type to search
                          </span>
                        )}
                      </div>
                    )}
                </div>
              ))}

              {chat.isLoading &&
                chat.messages[chat.messages.length - 1]?.status !== 'executing' && (
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
                      : 'Ask Isabelle anything about your inventory...'
                  }
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
                  disabled={chat.isLoading}
                />
                <button
                  onClick={() => chat.sendMessage()}
                  disabled={!chat.input.trim() || chat.isLoading}
                  className="px-4 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Send message"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          {/* ── Actions Panel ────────────────────────────── */}
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

            {/* Saved Prompts */}
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
      </div>
    </>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function ChatMessageBubble({
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
            ? 'bg-teal-600 text-white'
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
            className="mt-2 flex items-center gap-1 text-xs text-teal-600 hover:text-teal-800 underline"
          >
            <ExternalLink className="w-3 h-3" />
            Go to page
          </button>
        )}

        <div
          className={`text-xs mt-1 ${
            message.role === 'user' ? 'text-teal-100' : 'text-gray-400'
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
