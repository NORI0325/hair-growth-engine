import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  customerName?: string
  salonName?: string
  years?: number
  bookingLink?: string
}

const AnniversaryEmail = ({ customerName, salonName = 'サロン', years = 1, bookingLink }: Props) => (
  <Html lang="ja">
    <Head />
    <Preview>{`ご来店${years}周年のお祝い`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>— ANNIVERSARY —</Text>
        <Heading style={h1}>{customerName ? `${customerName} 様` : 'お客様'}</Heading>
        <Section style={celebrationBox}>
          <Text style={celebrationNum}>{years}</Text>
          <Text style={celebrationLabel}>YEARS WITH US</Text>
        </Section>
        <Text style={text}>
          {customerName ? `${customerName}様` : 'お客様'}が{salonName}に
          初めてご来店くださってから、本日で{years}年が経ちました。
        </Text>
        <Text style={text}>
          長きにわたりお選びいただいておりますこと、心より感謝申し上げます。
          記念のしるしとして、<strong>25%OFFクーポン</strong>をお贈りいたします。
        </Text>
        {bookingLink && (
          <Section style={{ textAlign: 'center', margin: '32px 0' }}>
            <Button href={bookingLink} style={button}>記念クーポンで予約する</Button>
          </Section>
        )}
        <Hr style={hr} />
        <Text style={footer}>{salonName}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: AnniversaryEmail,
  subject: (d: Record<string, any>) => `${d.salonName || 'サロン'}よりご来店${d.years || 1}周年のお祝い`,
  displayName: '来店記念日',
  previewData: { customerName: '山田 花子', salonName: 'ARUNE HAIR', years: 3, bookingLink: 'https://example.com/book/x' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Georgia, "Hiragino Mincho ProN", serif' }
const container = { padding: '40px 32px', maxWidth: '560px' }
const eyebrow = { fontSize: '10px', letterSpacing: '0.3em', color: '#b8946a', margin: '0 0 16px' }
const h1 = { fontSize: '22px', fontWeight: 'normal' as const, color: '#1a1a1a', margin: '0 0 24px' }
const text = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.9', margin: '0 0 18px' }
const celebrationBox = { textAlign: 'center' as const, padding: '32px 20px', margin: '24px 0', backgroundColor: '#faf7f2' }
const celebrationNum = { fontSize: '64px', color: '#b8946a', margin: '0 0 4px', lineHeight: 1, fontWeight: 'normal' as const }
const celebrationLabel = { fontSize: '11px', letterSpacing: '0.4em', color: '#b8946a', margin: 0 }
const button = { backgroundColor: '#1a1a1a', color: '#ffffff', padding: '14px 36px', fontSize: '11px', letterSpacing: '0.2em', textDecoration: 'none' }
const hr = { borderColor: '#e8e0d4', margin: '32px 0 20px' }
const footer = { fontSize: '11px', color: '#888', letterSpacing: '0.15em', textAlign: 'center' as const }
