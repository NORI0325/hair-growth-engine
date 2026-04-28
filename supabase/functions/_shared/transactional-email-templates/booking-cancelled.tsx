import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  customerName?: string
  salonName?: string
  bookingDate?: string
  bookingTime?: string
  menu?: string
  bookingLink?: string
}

const BookingCancelledEmail = ({ customerName, salonName = 'サロン', bookingDate, bookingTime, menu, bookingLink }: Props) => (
  <Html lang="ja">
    <Head />
    <Preview>ご予約のキャンセルを承りました</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>— RESERVATION CANCELLED —</Text>
        <Heading style={h1}>{customerName ? `${customerName} 様` : 'お客様'}</Heading>
        <Text style={text}>
          下記ご予約のキャンセルを承りました。
        </Text>
        <Section style={detailBox}>
          {bookingDate && <Text style={detail}><span style={label}>日付　</span>{bookingDate}</Text>}
          {bookingTime && <Text style={detail}><span style={label}>時間　</span>{bookingTime}</Text>}
          {menu && <Text style={detail}><span style={label}>メニュー　</span>{menu}</Text>}
        </Section>
        <Text style={text}>
          またのご来店を、スタッフ一同心よりお待ちしております。
        </Text>
        {bookingLink && (
          <Section style={{ textAlign: 'center', margin: '32px 0' }}>
            <Button href={bookingLink} style={button}>新たにご予約する</Button>
          </Section>
        )}
        <Hr style={hr} />
        <Text style={footer}>{salonName}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: BookingCancelledEmail,
  subject: (d: Record<string, any>) => `${d.salonName || 'サロン'}よりご予約キャンセル受付`,
  displayName: '予約キャンセル受付',
  previewData: { customerName: '山田 花子', salonName: 'ARUNE HAIR', bookingDate: '2026年5月10日(日)', bookingTime: '14:00', menu: 'カット & カラー', bookingLink: 'https://example.com/book/x' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Georgia, "Hiragino Mincho ProN", serif' }
const container = { padding: '40px 32px', maxWidth: '560px' }
const eyebrow = { fontSize: '10px', letterSpacing: '0.3em', color: '#b8946a', margin: '0 0 16px' }
const h1 = { fontSize: '22px', fontWeight: 'normal' as const, color: '#1a1a1a', margin: '0 0 24px' }
const text = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.9', margin: '0 0 18px' }
const detailBox = { backgroundColor: '#faf7f2', padding: '20px 24px', margin: '24px 0', borderLeft: '2px solid #b8946a' }
const detail = { fontSize: '13px', color: '#1a1a1a', lineHeight: '1.8', margin: '4px 0' }
const label = { color: '#888', fontSize: '11px', letterSpacing: '0.1em' }
const button = { backgroundColor: '#1a1a1a', color: '#ffffff', padding: '14px 36px', fontSize: '11px', letterSpacing: '0.2em', textDecoration: 'none' }
const hr = { borderColor: '#e8e0d4', margin: '32px 0 20px' }
const footer = { fontSize: '11px', color: '#888', letterSpacing: '0.15em', textAlign: 'center' as const }
