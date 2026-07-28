import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

type Detail = { label?: string; value?: string }

interface Props {
  subject?: string
  title?: string
  salonName?: string
  message?: string
  details?: Detail[]
  actionLabel?: string
  actionUrl?: string
}

const InternalNotificationEmail = ({
  subject = 'SalonBoostからのお知らせ',
  title = 'お知らせ',
  salonName,
  message,
  details = [],
  actionLabel,
  actionUrl,
}: Props) => (
  <Html lang="ja">
    <Head />
    <Preview>{subject}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>SALONBOOST NOTIFICATION</Text>
        <Heading style={heading}>{title}</Heading>
        {salonName ? <Text style={salon}>{salonName}</Text> : null}
        {message ? <Text style={messageStyle}>{message}</Text> : null}
        {details.length > 0 ? (
          <Section style={detailBox}>
            {details.slice(0, 12).map((detail, index) => (
              <Text key={`${detail.label ?? 'detail'}-${index}`} style={detailRow}>
                <strong>{detail.label || '項目'}:</strong> {detail.value || '-'}
              </Text>
            ))}
          </Section>
        ) : null}
        {actionUrl && actionLabel ? (
          <Button href={actionUrl} style={button}>{actionLabel}</Button>
        ) : null}
        <Hr style={hr} />
        <Text style={footer}>このメールはSalonBoostの運用通知です。</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: InternalNotificationEmail,
  subject: (data: Record<string, unknown>) => String(data.subject || 'SalonBoostからのお知らせ'),
  displayName: '内部運用通知',
  previewData: {
    subject: 'SalonBoostからのお知らせ',
    title: '確認が必要です',
    salonName: 'ARUNE HAIR',
    message: '管理画面で内容をご確認ください。',
    details: [{ label: '対象', value: '予約・顧客情報' }],
    actionLabel: '管理画面を開く',
    actionUrl: 'https://saronboost.com/dashboard',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#f6f5f2', fontFamily: '"Hiragino Sans", "Yu Gothic", Arial, sans-serif' }
const container = { backgroundColor: '#ffffff', margin: '24px auto', padding: '32px 28px', maxWidth: '560px' }
const eyebrow = { color: '#a18a5b', fontSize: '10px', letterSpacing: '0.18em', margin: '0 0 12px' }
const heading = { color: '#1a1a1a', fontSize: '22px', fontWeight: 600, lineHeight: 1.5, margin: '0 0 12px' }
const salon = { color: '#6b6258', fontSize: '13px', margin: '0 0 20px' }
const messageStyle = { color: '#34302b', fontSize: '14px', lineHeight: 1.8, whiteSpace: 'pre-wrap' as const, margin: '0 0 20px' }
const detailBox = { backgroundColor: '#faf8f3', border: '1px solid #ece5d3', padding: '16px 18px', margin: '0 0 22px' }
const detailRow = { color: '#34302b', fontSize: '13px', lineHeight: 1.7, margin: '0 0 6px', whiteSpace: 'pre-wrap' as const }
const button = { backgroundColor: '#1a1a1a', color: '#ffffff', fontSize: '13px', padding: '12px 20px', textDecoration: 'none' }
const hr = { borderColor: '#ece5d3', margin: '30px 0 16px' }
const footer = { color: '#999999', fontSize: '11px', margin: 0 }
