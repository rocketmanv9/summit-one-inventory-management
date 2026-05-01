'use client';

import { useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { X, Send, Loader2, ExternalLink } from 'lucide-react';
import { useAiPanel } from '@/lib/ai/panel-store';
import { useAiChat } from '@/lib/ai/useAiChat';
import { QUICK_ACTIONS } from '@/lib/ai/types';
import type { Message } from '@/lib/ai/types';
import { AiDataRenderer } from './AiDataRenderer';
import { ImageAttachment } from './ImageAttachment';
import { AddVendorModal } from '@/components/modals/AddVendorModal';

export function AiSidePanel() {
  const { isOpen, close } = useAiPanel();
  const pathname = usePathname();

  const chat = useAiChat({
    mode: 'panel',
    pageContext: { currentPage: pathname },
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.messages]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chat.sendMessage();
    }
    if (e.key === 'Escape') {
      close();
    }
  };

  const quickActions = QUICK_ACTIONS[pathname] || [];

  return (
    <>
      {/* Vendor Modal */}
      <AddVendorModal
        open={chat.vendorModal.open}
        onClose={chat.vendorModal.onClose}
        onSuccess={chat.vendorModal.onSuccess}
        initialName={chat.vendorModal.initialName}
      />

      {/* Side Panel */}
      <div
        className={`fixed top-0 right-0 z-40 h-full w-[400px] bg-white border-l border-gray-200 shadow-xl flex flex-col transition-transform duration-200 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-gradient-to-r from-blue-600 to-blue-700 text-white flex-shrink-0">
          <div className="flex items-center gap-2">
            <img
              src="/avatar/avatar.svg"
              alt="Isabelle"
              className="w-8 h-8 rounded-full border border-white/30"
            />
            <div>
              <h3 className="font-semibold text-sm">Isabelle Martinez</h3>
              <p className="text-xs text-blue-100">Ask Isabelle anything</p>
            </div>
          </div>
          <button
            onClick={close}
            className="hover:bg-blue-800 rounded p-1 transition-colors"
            aria-label="Close AI panel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {chat.messages.map((message) => (
            <div key={message.id}>
              <PanelMessageBubble
                message={message}
                onNavigate={chat.navigate}
              />

              {/* Data display */}
              {message.dataDisplay && (
                <div className="max-w-full mt-1">
                  <AiDataRenderer data={message.dataDisplay} />
                </div>
              )}

              {/* Select options */}
              {message.selectOptions &&
                message.selectOptions.length > 0 &&
                chat.activeFlow &&
                chat.activeFlow.action.steps[chat.activeFlow.currentStepIndex]?.type === 'select' && (
                  <div className="mt-2 ml-1 flex flex-wrap gap-1.5">
                    {message.selectOptions.slice(0, 8).map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => chat.handleSelectOption(opt.value)}
                        disabled={chat.isLoading}
                        className="px-2.5 py-1 text-xs bg-white border border-gray-300 rounded-full hover:bg-blue-50 hover:border-blue-400 transition-colors disabled:opacity-50 text-gray-700"
                      >
                        {opt.label}
                      </button>
                    ))}
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
          <div className="px-4 py-1.5 bg-blue-50 border-t border-blue-100 flex items-center justify-between flex-shrink-0">
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

        {/* Quick actions */}
        {!chat.activeFlow && quickActions.length > 0 && (
          <div className="px-3 py-1.5 border-t border-gray-100 flex flex-wrap gap-1.5 flex-shrink-0">
            {quickActions.slice(0, 6).map((qa) => (
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
        <div className="p-3 border-t flex-shrink-0">
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

// ─── Message Bubble ──────────────────────────────────────────────────

function PanelMessageBubble({
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
