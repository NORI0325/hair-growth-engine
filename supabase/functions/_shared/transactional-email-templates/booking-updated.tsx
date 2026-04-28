import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  customerName?: string
  salonName?: string
  bookingDate?: string
  bookingTime?: string
  menu?: string
}

const BookingUpdatedEmail = ({ customerName, salonName = 'サロン', bookingDate, bookingTime, menu }: Props) => (
  <Html lang="ja">
    <Head />
    <Preview>ご予約の変更を承りました</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>— RESERVATION UPDATED —</Text>
        <Heading style={h1}>{customerName ? `${customerName} 様` : 'お客様'}</Heading>
        <Text style={text}>
          ご予約内容の変更を承りました。新しいご予約内容は下記の通りです。
        </Text>
        <Section style={detailBox}>
          {bookingDate && <Text style={detail}><span style={label}>日付　</span>{bookingDate}</Text>}
          {bookingTime && <Text style={detail}><span style={label}>時間　</span>{bookingTime}</Text>}
          {menu && <Text style={detail}><span style={label}>メニュー　</span>{menu}</Text>}
        </Section>
        <Text style={text}>
          ご来店を心よりお待ちしております。
        </Text>
        <Hr style={hr} />
        <Text style={footer}>{salonName}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: BookingUpdatedEmail,
  subject: (d: Record<string, any>) => `${d.salonName || 'サロン'}よりご予約変更受付`,
  displayName: '予約変更受付',
  previewData: { customerName: '山田 花子', salonName: 'ARUNE HAIR', bookingDate: '2026年5月12日(火)', bookingTime: '15:00', menu: 'カット & カラー' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Georgia, "Hiragino Mincho ProN", serif' }
const container = { padding: '40px 32px', maxWidth: '560px' }
const eyebrow = { fontSize: '10px', letterSpacing: '0.3em', color: '#b8946a', margin: '0 0 16px' }
const h1 = { fontSize: '22px', fontWeight: 'normal' as const, color: '#1a1a1a', margin: '0 0 24px' }
const text = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.9', margin: '0 0 18px' }
const detailBox = { backgroundColor: '#faf7f2', padding: '20px 24px', margin: '24px 0', borderLeft: '2px solid #b8946a' }
const detail = { fontSize: '13px', color: '#1a1a1a', lineHeight: '1.8', margin: '4px 0' }
const label = { color: '#888', fontSize: '11px', letterSpacing: '0.1em' }
const hr = { borderColor: '#e8e0d4', margin: '32px 0 20px' }
const footer = { fontSize: '11px', color: '#888', letterSpacing: '0.15em', textAlign: 'center' as const }
