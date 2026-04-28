import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  customerName?: string
  salonName?: string
  referredName?: string
  bookingLink?: string
}

const ReferralThanksEmail = ({ customerName, salonName = 'サロン', referredName, bookingLink }: Props) => (
  <Html lang="ja">
    <Head />
    <Preview>ご紹介いただき、誠にありがとうございます</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>— THANK YOU FOR YOUR REFERRAL —</Text>
        <Heading style={h1}>{customerName ? `${customerName} 様` : 'お客様'}</Heading>
        <Text style={text}>
          このたびは{referredName ? `${referredName}様を` : 'お客様を'}
          {salonName}にご紹介いただき、誠にありがとうございました。
        </Text>
        <Text style={text}>
          {customerName ? `${customerName}様` : 'お客様'}からの大切なご紹介は、
          私どもにとって何よりの励みとなります。
          感謝のしるしとして <strong>次回ご予約 20%OFF クーポン</strong> をお贈りいたします。
        </Text>
        {bookingLink && (
          <Section style={{ textAlign: 'center', margin: '32px 0' }}>
            <Button href={bookingLink} style={button}>クーポンで予約する</Button>
          </Section>
        )}
        <Hr style={hr} />
        <Text style={footer}>{salonName}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: ReferralThanksEmail,
  subject: (d: Record<string, any>) => `${d.salonName || 'サロン'}より ご紹介の御礼`,
  displayName: '紹介お礼&クーポン',
  previewData: { customerName: '山田 花子', salonName: 'ARUNE HAIR', referredName: '佐藤 美咲', bookingLink: 'https://example.com/book/x' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Georgia, "Hiragino Mincho ProN", serif' }
const container = { padding: '40px 32px', maxWidth: '560px' }
const eyebrow = { fontSize: '10px', letterSpacing: '0.3em', color: '#b8946a', margin: '0 0 16px' }
const h1 = { fontSize: '22px', fontWeight: 'normal' as const, color: '#1a1a1a', margin: '0 0 24px' }
const text = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.9', margin: '0 0 18px' }
const button = { backgroundColor: '#1a1a1a', color: '#ffffff', padding: '14px 36px', fontSize: '11px', letterSpacing: '0.2em', textDecoration: 'none' }
const hr = { borderColor: '#e8e0d4', margin: '32px 0 20px' }
const footer = { fontSize: '11px', color: '#888', letterSpacing: '0.15em', textAlign: 'center' as const }
