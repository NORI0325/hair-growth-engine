import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  customerName?: string
  salonName?: string
  bookingLink?: string
}

const NextSuggestionEmail = ({ customerName, salonName = 'サロン', bookingLink }: Props) => (
  <Html lang="ja">
    <Head />
    <Preview>次回ご予約のおすすめ時期のご案内</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>— TIME FOR YOUR NEXT VISIT —</Text>
        <Heading style={h1}>{customerName ? `${customerName} 様` : 'お客様'}</Heading>
        <Text style={text}>
          前回のご来店から、約1ヶ月が経ちました。
          根元の伸びやカラーの色落ちが気になり始める時期でございます。
        </Text>
        <Text style={text}>
          {salonName}では、お一人おひとりの髪のコンディションに合わせた
          メンテナンスをご提案しております。
          今のうちにご予約いただくと、ご希望のお日にちが選びやすくなっております。
        </Text>
        {bookingLink && (
          <Section style={{ textAlign: 'center', margin: '32px 0' }}>
            <Button href={bookingLink} style={button}>次回のご予約はこちら</Button>
          </Section>
        )}
        <Hr style={hr} />
        <Text style={footer}>{salonName}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: NextSuggestionEmail,
  subject: (d: Record<string, any>) => `${d.salonName || 'サロン'}より 次回ご予約のご案内`,
  displayName: '次回ご予約提案（30日後）',
  previewData: { customerName: '山田 花子', salonName: 'ARUNE HAIR', bookingLink: 'https://example.com/book/x' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Georgia, "Hiragino Mincho ProN", serif' }
const container = { padding: '40px 32px', maxWidth: '560px' }
const eyebrow = { fontSize: '10px', letterSpacing: '0.3em', color: '#b8946a', margin: '0 0 16px' }
const h1 = { fontSize: '22px', fontWeight: 'normal' as const, color: '#1a1a1a', margin: '0 0 24px' }
const text = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.9', margin: '0 0 18px' }
const button = { backgroundColor: '#1a1a1a', color: '#ffffff', padding: '14px 36px', fontSize: '11px', letterSpacing: '0.2em', textDecoration: 'none' }
const hr = { borderColor: '#e8e0d4', margin: '32px 0 20px' }
const footer = { fontSize: '11px', color: '#888', letterSpacing: '0.15em', textAlign: 'center' as const }
