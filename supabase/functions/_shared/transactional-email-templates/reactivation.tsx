import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  customerName?: string
  salonName?: string
  bookingLink?: string
  daysSince?: number
  discountPercent?: number
  label?: string
}

const ReactivationEmail = ({ customerName, salonName = 'サロン', bookingLink, daysSince, discountPercent = 0, label }: Props) => (
  <Html lang="ja">
    <Head />
    <Preview>{label || 'お久しぶりです'}。特別なご案内をお贈りします</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>— WE MISS YOU —</Text>
        <Heading style={h1}>{customerName ? `${customerName} 様` : 'お客様'}</Heading>
        <Text style={text}>
          お久しぶりでございます。
          {daysSince ? `前回のご来店から${daysSince}日が経ちました。` : ''}
          いかがお過ごしでしょうか。
        </Text>
        {discountPercent > 0 ? (
          <Text style={text}>
            またお会いできる日を心待ちにしておりまして、
            ささやかですが <strong>{discountPercent}%OFF{label ? `（${label}）` : ''}</strong> をご用意いたしました。
            季節の変わり目、ぜひ気分転換にいらしてください。
          </Text>
        ) : (
          <Text style={text}>
            季節の変わり目、根元の伸びやカラーの色落ちが気になり始める時期です。
            またお会いできる日を心待ちにしております。
          </Text>
        )}
        {bookingLink && (
          <Section style={{ textAlign: 'center', margin: '32px 0' }}>
            <Button href={bookingLink} style={button}>
              {discountPercent > 0 ? 'クーポンで予約する' : 'ご予約はこちら'}
            </Button>
          </Section>
        )}
        <Hr style={hr} />
        <Text style={footer}>{salonName}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: ReactivationEmail,
  subject: (d: Record<string, any>) => {
    const dp = Number(d.discountPercent) || 0
    if (dp > 0) return `${d.salonName || 'サロン'}より ${dp}%OFFの特別ご案内`
    return `${d.salonName || 'サロン'}より お元気ですか`
  },
  displayName: '休眠復活クーポン',
  previewData: { customerName: '山田 花子', salonName: 'ARUNE HAIR', bookingLink: 'https://example.com/book/x', daysSince: 95, discountPercent: 20, label: 'おかえりなさい' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Georgia, "Hiragino Mincho ProN", serif' }
const container = { padding: '40px 32px', maxWidth: '560px' }
const eyebrow = { fontSize: '10px', letterSpacing: '0.3em', color: '#b8946a', margin: '0 0 16px' }
const h1 = { fontSize: '22px', fontWeight: 'normal' as const, color: '#1a1a1a', margin: '0 0 24px' }
const text = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.9', margin: '0 0 18px' }
const button = { backgroundColor: '#1a1a1a', color: '#ffffff', padding: '14px 36px', fontSize: '11px', letterSpacing: '0.2em', textDecoration: 'none' }
const hr = { borderColor: '#e8e0d4', margin: '32px 0 20px' }
const footer = { fontSize: '11px', color: '#888', letterSpacing: '0.15em', textAlign: 'center' as const }
