import React from 'react';
import { CARD_TYPES } from '../../utils/chatCards';
import {
  QuickReplyCard, IncidentCard, FormCard, ConfirmCard, ApprovalCard,
  StatusCard, BriefingCard, SlaAlertCard, KbCard, ListCard,
  TeamCard, ProgressCard, CarouselCard, MetricCard,
} from './cards';

const CARD_MAP = {
  [CARD_TYPES.QUICK_REPLY]:    QuickReplyCard,
  [CARD_TYPES.INCIDENT_CARD]:  IncidentCard,
  [CARD_TYPES.FORM_CARD]:      FormCard,
  [CARD_TYPES.CONFIRM_CARD]:   ConfirmCard,
  [CARD_TYPES.APPROVAL_CARD]:  ApprovalCard,
  [CARD_TYPES.STATUS_CARD]:    StatusCard,
  [CARD_TYPES.BRIEFING_CARD]:  BriefingCard,
  [CARD_TYPES.SLA_ALERT_CARD]: SlaAlertCard,
  [CARD_TYPES.KB_CARD]:        KbCard,
  [CARD_TYPES.LIST_CARD]:      ListCard,
  [CARD_TYPES.TEAM_CARD]:      TeamCard,
  [CARD_TYPES.PROGRESS_CARD]:  ProgressCard,
  [CARD_TYPES.CAROUSEL_CARD]:  CarouselCard,
  [CARD_TYPES.METRIC_CARD]:    MetricCard,
};

/**
 * Renders a list of chat cards. Each card has { type, id, data, actions }.
 * @param {Object} props
 * @param {Array} props.cards - Array of card objects
 * @param {Function} props.onAction - Callback when user interacts with a card action
 */
export default function CardRenderer({ cards, onAction }) {
  if (!cards || cards.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
      {cards.map((card) => {
        const Component = CARD_MAP[card.type];
        if (!Component) {
          console.warn(`[CardRenderer] Unknown card type: ${card.type}`);
          return null;
        }
        return (
          <Component
            key={card.id || `${card.type}_${Math.random()}`}
            data={card.data}
            actions={card.actions}
            onAction={onAction}
          />
        );
      })}
    </div>
  );
}
