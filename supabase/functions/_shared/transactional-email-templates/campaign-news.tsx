import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  customerName?: string
  salonName?: string
  campaignTitle?: string
  campaignBody?: string
  bookingLink?: string
}

const CampaignNewsEmail = ({ customerName, salonName = 'サロン', campaignTitle, campaignBody, bookingLink }: Props) => (
  <Html lang="ja">
    <Head />
    <Preview>{campaignTitle || '新メニュー・キャンペーンのご案内'}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>— SEASONAL OFFER —</Text>
        <Heading style={h1}>{campaignTitle || '新メニューのご案内'}</Heading>
        {customerName && <Text style={text}>{customerName} 様</Text>}
        <Text style={text}>
          {campaignBody || 'この度、新たなメニューのご案内をお送りいたします。'}
        </Text>
        {bookingLink && (
          <Section style={{ textAlign: 'center', margin: '32px 0' }}>
            <Button href={bookingLink} style={button}>詳細を見て予約する</Button>
          </Section>
        )}
        <Hr style={hr} />
        <Text style={footer}>{salonName}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: CampaignNewsEmail,
  subject: (d: Record<string, any>) => d.campaignTitle || `${d.salonName || 'サロン'}より新メニューのご案内`,
  displayName: 'キャンペーン案内',
  previewData: { customerName: '山田 花子', salonName: 'ARUNE HAIR', campaignTitle: '春の新色カラーキャンペーン', campaignBody: '今春注目のニュアンスカラーを期間限定でご提供いたします。', bookingLink: 'https://example.com/book/x' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Georgia, "Hiragino Mincho ProN", serif' }
const container = { padding: '40px 32px', maxWidth: '560px' }
const eyebrow = { fontSize: '10px', letterSpacing: '0.3em', color: '#b8946a', margin: '0 0 16px' }
const h1 = { fontSize: '22px', fontWeight: 'normal' as const, color: '#1a1a1a', margin: '0 0 24px' }
const text = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.9', margin: '0 0 18px', whiteSpace: 'pre-wrap' as const }
const button = { backgroundColor: '#1a1a1a', color: '#ffffff', padding: '14px 36px', fontSize: '11px', letterSpacing: '0.2em', textDecoration: 'none' }
const hr = { borderColor: '#e8e0d4', margin: '32px 0 20px' }
const footer = { fontSize: '11px', color: '#888', letterSpacing: '0.15em', textAlign: 'center' as const }
