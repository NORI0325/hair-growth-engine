/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as thankYou } from './thank-you.tsx'
import { template as birthday } from './birthday.tsx'
import { template as reviewRequest } from './review-request.tsx'
import { template as bookingConfirmation } from './booking-confirmation.tsx'
import { template as bookingAlertOwner } from './booking-alert-owner.tsx'
import { template as bookingReminder } from './booking-reminder.tsx'
import { template as aftercare } from './aftercare.tsx'
import { template as nextSuggestion } from './next-suggestion.tsx'
import { template as reactivation } from './reactivation.tsx'
import { template as vipUpgrade } from './vip-upgrade.tsx'
import { template as bookingCancelled } from './booking-cancelled.tsx'
import { template as bookingUpdated } from './booking-updated.tsx'
import { template as welcomeNewCustomer } from './welcome-new-customer.tsx'
import { template as anniversary } from './anniversary.tsx'
import { template as campaignNews } from './campaign-news.tsx'
import { template as referralThanks } from './referral-thanks.tsx'
import { template as holidayNotice } from './holiday-notice.tsx'
import { template as inquiryReceived } from './inquiry-received.tsx'
import { template as homecareRecommendation } from './homecare-recommendation.tsx'
import { template as teamInvitation } from './team-invitation.tsx'
import { template as internalNotification } from './internal-notification.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'thank-you': thankYou,
  'birthday': birthday,
  'review-request': reviewRequest,
  'booking-confirmation': bookingConfirmation,
  'booking-alert-owner': bookingAlertOwner,
  'booking-reminder': bookingReminder,
  'aftercare': aftercare,
  'next-suggestion': nextSuggestion,
  'reactivation': reactivation,
  'vip-upgrade': vipUpgrade,
  'booking-cancelled': bookingCancelled,
  'booking-updated': bookingUpdated,
  'welcome-new-customer': welcomeNewCustomer,
  'anniversary': anniversary,
  'campaign-news': campaignNews,
  'referral-thanks': referralThanks,
  'holiday-notice': holidayNotice,
  'inquiry-received': inquiryReceived,
  'homecare-recommendation': homecareRecommendation,
  'team-invitation': teamInvitation,
  'internal-notification': internalNotification,
}
