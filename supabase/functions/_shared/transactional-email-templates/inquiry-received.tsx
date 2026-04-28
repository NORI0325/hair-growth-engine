import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  customerName?: string
  salonName?: string
  inquiryBody?: string
}

const InquiryReceivedEmail = ({ customerName, salonName = 'サロン', inquiryBody }: Props) => (
  <Html lang="ja">
    <Head />
    <Preview>お問い合わせを承りました</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>— INQUIRY RECEIVED —</Text>
        <Heading style={h1}>{customerName ? `${customerName} 様` : 'お客様'}</Heading>
        <Text style={text}>
          このたびは{salonName}へお問い合わせいただき、誠にありがとうございます。
          下記の内容にて承りました。
        </Text>
        {inquiryBody && (
          <Section style={quoteBox}>
            <Text style={quote}>{inquiryBody}</Text>
          </Section>
        )}
        <Text style={text}>
          内容を確認の上、担当者より2営業日以内にご返信いたします。
          今しばらくお待ちくださいませ。
        </Text>
        <Hr style={hr} />
        <Text style={footer}>{salonName}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: InquiryReceivedEmail,
  subject: (d: Record<string, any>) => `${d.salonName || 'サロン'}よりお問い合わせ受付`,
  displayName: 'お問い合わせ受付',
  previewData: { customerName: '山田 花子', salonName: 'ARUNE HAIR', inquiryBody: 'パーマの持ちについて教えてください。' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Georgia, "Hiragino Mincho ProN", serif' }
const container = { padding: '40px 32px', maxWidth: '560px' }
const eyebrow = { fontSize: '10px', letterSpacing: '0.3em', color: '#b8946a', margin: '0 0 16px' }
const h1 = { fontSize: '22px', fontWeight: 'normal' as const, color: '#1a1a1a', margin: '0 0 24px' }
const text = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.9', margin: '0 0 18px' }
const quoteBox = { backgroundColor: '#faf7f2', padding: '20px 24px', margin: '24px 0', borderLeft: '2px solid #b8946a' }
const quote = { fontSize: '13px', color: '#1a1a1a', lineHeight: '1.8', margin: 0, whiteSpace: 'pre-wrap' as const, fontStyle: 'italic' as const }
const hr = { borderColor: '#e8e0d4', margin: '32px 0 20px' }
const footer = { fontSize: '11px', color: '#888', letterSpacing: '0.15em', textAlign: 'center' as const }
