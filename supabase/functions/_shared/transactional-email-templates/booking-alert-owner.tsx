import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface BookingAlertOwnerProps {
  eventType?: 'created' | 'cancelled' | 'updated'
  customerName?: string
  customerPhone?: string
  bookingDate?: string
  bookingTime?: string
  menu?: string
  notes?: string
  salonName?: string
}

const labelByType = (t: string) => {
  if (t === 'cancelled') return { ja: 'キャンセル', emoji: '❌', color: '#b91c1c' }
  if (t === 'updated') return { ja: '変更', emoji: '✏️', color: '#b45309' }
  return { ja: '新規予約', emoji: '📅', color: '#0f6f43' }
}

const BookingAlertOwnerEmail = ({
  eventType = 'created',
  customerName = 'お客様',
  customerPhone,
  bookingDate,
  bookingTime,
  menu,
  notes,
  salonName,
}: BookingAlertOwnerProps) => {
  const meta = labelByType(eventType)
  return (
    <Html lang="ja" dir="ltr">
      <Head />
      <Preview>{`${meta.emoji} ${meta.ja}：${customerName}様 / ${bookingDate ?? ''} ${bookingTime ?? ''}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={eyebrow}>— Salon Boost Alert —</Text>
          <Heading style={{ ...h1, color: meta.color }}>
            {meta.emoji} {meta.ja}が入りました
          </Heading>

          <Section style={card}>
            <Row label="お客様" value={customerName} />
            {customerPhone ? <Row label="電話" value={customerPhone} /> : null}
            <Row label="日付" value={bookingDate ?? '—'} />
            <Row label="時間" value={bookingTime ?? '—'} />
            <Row label="メニュー" value={menu ?? '—'} />
            {notes ? <Row label="備考" value={notes} /> : null}
          </Section>

          <Hr style={hr} />
          <Text style={footer}>
            {salonName ?? 'Salon Boost'} 予約通知
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <table style={{ width: '100%', marginBottom: '8px' }}>
    <tbody>
      <tr>
        <td style={rowLabel}>{label}</td>
        <td style={rowValue}>{value}</td>
      </tr>
    </tbody>
  </table>
)

export const template = {
  component: BookingAlertOwnerEmail,
  subject: (data: Record<string, any>) => {
    const t = data?.eventType === 'cancelled' ? 'キャンセル'
      : data?.eventType === 'updated' ? '変更'
      : '新規予約'
    return `【${t}】${data?.customerName ?? 'お客様'}様 ${data?.bookingDate ?? ''} ${data?.bookingTime ?? ''}`
  },
  displayName: 'オーナー予約通知',
  previewData: {
    eventType: 'created',
    customerName: '山田 花子',
    customerPhone: '090-1234-5678',
    bookingDate: '2026-05-15',
    bookingTime: '14:00',
    menu: 'カット＋カラー',
    notes: '前回より明るめ希望',
    salonName: 'arune hair',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: '"Hiragino Sans", "Yu Gothic", Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const eyebrow = { fontSize: '10px', letterSpacing: '0.2em', color: '#a18a5b', textTransform: 'uppercase' as const, margin: '0 0 8px' }
const h1 = { fontSize: '22px', fontWeight: 600, margin: '0 0 24px', lineHeight: 1.4 }
const card = { backgroundColor: '#faf8f3', border: '1px solid #ece5d3', padding: '20px 22px', borderRadius: '2px' }
const rowLabel = { fontSize: '11px', color: '#8a8275', width: '70px', verticalAlign: 'top' as const, padding: '4px 0' }
const rowValue = { fontSize: '14px', color: '#1a1a1a', verticalAlign: 'top' as const, padding: '4px 0' }
const hr = { borderColor: '#ece5d3', margin: '32px 0 16px' }
const footer = { fontSize: '11px', color: '#999', margin: 0 }
