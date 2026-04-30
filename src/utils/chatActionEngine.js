// ─── Chat Action Engine — Executes card actions ────────────────────────────
// Handles ACTION_TYPES: navigate, open_modal, api_call, chat_reply,
// confirm, submit_form, approve, reject, copy, external

import { ACTION_TYPES } from './chatCards';
import { makeConfirmCard, makeProgressCard, makeStatusCard } from './chatCards';

/**
 * Create an action handler bound to the app's state setters.
 * @param {Object} handlers - Object with app-level functions
 * @returns {Function} handleCardAction(action) 
 */
export function createActionHandler(handlers) {
  const {
    setActiveModule,     // navigate to module
    setModal,            // open modal dialog
    setShowAiPanel,      // close AI panel
    handleAiChat,        // send message to AI
    showToast,           // show toast notification
    addCards,            // inject cards into last AI message
    setShowDupPanel,     // show duplicate panel
    setShowAiActionsPanel, // show AI actions panel
    setShowFloatingKbTraining, // show KB training
  } = handlers;

  return async function handleCardAction(action) {
    if (!action || !action.type) return;

    switch (action.type) {
      case ACTION_TYPES.NAVIGATE: {
        const { module, id } = action.payload || {};
        if (module) {
          setShowAiPanel(false);
          setActiveModule(module);
          if (module === 'incidents' && action.payload?.showDups) {
            setTimeout(() => setShowDupPanel(true), 100);
          }
        }
        break;
      }

      case ACTION_TYPES.OPEN_MODAL: {
        const { modal } = action.payload || {};
        if (modal) {
          setShowAiPanel(false);
          setModal(modal);
        }
        break;
      }

      case ACTION_TYPES.CHAT_REPLY: {
        const { text } = action.payload || {};
        if (text) handleAiChat(text);
        break;
      }

      case ACTION_TYPES.API_CALL: {
        const { endpoint, method, formData, formName } = action.payload || {};
        if (!endpoint) break;
        try {
          // Show progress card
          addCards([makeProgressCard(`${formName || 'Request'}`, [
            { label: 'Validating', status: 'done' },
            { label: 'Submitting', status: 'active' },
            { label: 'Complete', status: 'pending' },
          ])]);

          const res = await fetch(endpoint, {
            method: method || 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData || {}),
          });

          if (res.ok) {
            const result = await res.json().catch(() => ({}));
            showToast?.(`${formName || 'Request'} created successfully`, 'success');
            addCards([makeStatusCard(`${formName || 'Request'} Created`, [
              { icon: '✅', label: 'Status', value: 'Success', color: '#22C55E' },
              ...(result.id ? [{ icon: '🆔', label: 'ID', value: result.id }] : []),
            ])]);
          } else {
            showToast?.(`Failed to create ${formName || 'request'}`, 'error');
            addCards([makeStatusCard('Error', [
              { icon: '❌', label: 'Status', value: `Failed (${res.status})`, color: '#EF4444' },
            ])]);
          }
        } catch (err) {
          showToast?.(`Error: ${err.message}`, 'error');
        }
        break;
      }

      case ACTION_TYPES.SUBMIT_FORM: {
        // Re-route to API_CALL with form data
        return handleCardAction({ type: ACTION_TYPES.API_CALL, payload: action.payload });
      }

      case ACTION_TYPES.CONFIRM: {
        // Payload contains the actual action to execute after confirmation
        const confirmed = action.payload;
        if (confirmed) {
          return handleCardAction(confirmed);
        }
        break;
      }

      case ACTION_TYPES.APPROVE: {
        const { id, comment } = action.payload || {};
        try {
          const res = await fetch(`/api/changes/${id}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comment }),
          });
          showToast?.(res.ok ? `Change ${id} approved` : `Failed to approve ${id}`, res.ok ? 'success' : 'error');
        } catch (err) {
          showToast?.(`Error: ${err.message}`, 'error');
        }
        break;
      }

      case ACTION_TYPES.REJECT: {
        const { id, comment } = action.payload || {};
        if (id) {
          try {
            const res = await fetch(`/api/changes/${id}/reject`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ comment }),
            });
            showToast?.(res.ok ? `Change ${id} rejected` : `Failed to reject ${id}`, res.ok ? 'success' : 'error');
          } catch (err) {
            showToast?.(`Error: ${err.message}`, 'error');
          }
        }
        break;
      }

      case ACTION_TYPES.COPY: {
        const { text } = action.payload || {};
        if (text && navigator.clipboard) {
          await navigator.clipboard.writeText(text);
          showToast?.('Copied to clipboard', 'info');
        }
        break;
      }

      case ACTION_TYPES.EXTERNAL: {
        const { url } = action.payload || {};
        if (url) {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
        break;
      }

      default:
        console.warn(`[ChatActionEngine] Unknown action type: ${action.type}`);
    }
  };
}
