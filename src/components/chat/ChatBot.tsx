'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Send, Loader2, ExternalLink, Check, XCircle } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { AddVendorModal } from '@/components/modals/AddVendorModal';
import { useAiChat } from '@/lib/ai/useAiChat';
import { QUICK_ACTIONS } from '@/lib/ai/types';
import type { Message, ChatAction } from '@/lib/ai/types';
import { AiDataRenderer } from '@/components/ai/AiDataRenderer';
import { ImageAttachment } from '@/components/ai/ImageAttachment';

// ─── Component ────────────────────────────────────────────────────────

interface ChatBotProps {
  onClose?: () => void;
}

export function ChatBot({ onClose }: ChatBotProps) {
  const pathname = usePathname();

  const chat = useAiChat({
    mode: 'corner',
    pageContext: { currentPage: pathname },
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.messages]);

  // Focus input when mounted
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chat.sendMessage();
    }
  };

  const quickActions = QUICK_ACTIONS[pathname] || [];

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <>
      {/* Vendor Modal */}
      <AddVendorModal
        open={chat.vendorModal.open}
        onClose={chat.vendorModal.onClose}
        onSuccess={chat.vendorModal.onSuccess}
        initialName={chat.vendorModal.initialName}
      />

      {/* Chat Window */}
      <div className="fixed bottom-6 right-6 w-[420px] h-[620px] bg-white rounded-xl shadow-2xl flex flex-col z-50 border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-blue-600 text-white">
          <div className="flex items-center gap-2">
            <div>
              <h3 className="font-semibold text-sm">Isabelle Martinez</h3>
              <p className="text-xs text-blue-100">Inventory Assistant</p>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="hover:bg-blue-700 rounded p-1 transition-colors"
              aria-label="Close chat"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {chat.messages.map((message) => (
            <div key={message.id}>
              {/* Action Preview Card */}
              {message.action && message.action.status === 'proposed' ? (
                <ActionPreviewCard
                  action={message.action}
                  onConfirm={() => chat.confirmAction(message.action!.id)}
                  onCancel={() => chat.cancelAction(message.action!.id)}
                />
              ) : (
                <MessageBubble
                  message={message}
                  onNavigate={chat.navigate}
                />
              )}

              {/* Data display for server-side query results */}
              {message.dataDisplay && (
                <div className="max-w-[85%]">
                  <AiDataRenderer data={message.dataDisplay} />
                </div>
              )}

              {/* Inline select options */}
              {message.selectOptions &&
                message.selectOptions.length > 0 &&
                chat.activeFlow &&
                chat.activeFlow.action.steps[chat.activeFlow.currentStepIndex]?.type === 'select' && (
                  <div className="mt-2 ml-1 flex flex-wrap gap-1.5">
                    {message.selectOptions.slice(0, 10).map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => chat.handleSelectOption(opt.value)}
                        disabled={chat.isLoading}
                        className="px-2.5 py-1 text-xs bg-white border border-gray-300 rounded-full hover:bg-blue-50 hover:border-blue-400 transition-colors disabled:opacity-50 text-gray-700"
                      >
                        {opt.label}
                      </button>
                    ))}
                    {message.selectOptions.length > 10 && (
                      <span className="px-2 py-1 text-xs text-gray-400">
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
                <div className="bg-gray-100 rounded-lg px-3 py-2">
                  <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                </div>
              </div>
            )}

          <div ref={messagesEndRef} />
        </div>

        {/* Active flow indicator */}
        {chat.activeFlow && (
          <div className="px-4 py-1.5 bg-blue-50 border-t border-blue-100 flex items-center justify-between">
            <span className="text-xs text-blue-600">
              {chat.activeFlow.action.description} — step{' '}
              {Math.min(
                chat.activeFlow.currentStepIndex + 1,
                chat.activeFlow.action.steps.length
              )}{' '}
              of {chat.activeFlow.action.steps.length}
            </span>
            <button
              onClick={chat.cancelFlow}
              className="text-xs text-red-500 hover:text-red-700"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Quick Action Chips */}
        {!chat.activeFlow && quickActions.length > 0 && (
          <div className="px-3 py-1.5 border-t border-gray-100 flex flex-wrap gap-1.5">
            {quickActions.map((qa) => (
              <button
                key={qa.label}
                onClick={() => chat.sendMessage(qa.message)}
                disabled={chat.isLoading}
                className="px-2.5 py-1 text-xs bg-gray-50 border border-gray-200 rounded-full hover:bg-blue-50 hover:border-blue-300 transition-colors disabled:opacity-50 text-gray-600"
              >
                {qa.label}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="p-3 border-t">
          <div className="flex items-center gap-2">
            <ImageAttachment
              pendingImage={chat.pendingImage}
              onImageAttach={(dataUrl) => chat.setPendingImage(dataUrl)}
              onImageRemove={() => chat.setPendingImage(null)}
              disabled={chat.isLoading}
            />
            <input
              ref={inputRef}
              type="text"
              value={chat.input}
              onChange={(e) => chat.setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                chat.pendingImage
                  ? 'Describe the image or say "add 4 to Auburn Yard"...'
                  : chat.activeFlow
                    ? 'Type your answer...'
                    : 'Ask me anything...'
              }
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              disabled={chat.isLoading}
            />
            <button
              onClick={() => chat.sendMessage()}
              disabled={(!chat.input.trim() && !chat.pendingImage) || chat.isLoading}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function MessageBubble({
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
        className={`max-w-[85%] rounded-lg px-3 py-2 ${
          message.role === 'user'
            ? 'bg-blue-600 text-white'
            : message.status === 'error'
              ? 'bg-red-50 text-red-900 border border-red-200'
              : message.status === 'success'
                ? 'bg-green-50 text-green-900 border border-green-200'
                : 'bg-gray-100 text-gray-900'
        }`}
      >
        {/* Attached image */}
        {message.imageUrl && (
          <img
            src={message.imageUrl}
            alt="Attached"
            className="rounded max-w-[200px] max-h-[200px] object-contain mb-1"
          />
        )}

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

function ActionPreviewCard({
  action,
  onConfirm,
  onCancel,
}: {
  action: ChatAction;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] border rounded-lg p-3 bg-blue-50 border-blue-200">
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
    </div>
  );
}
