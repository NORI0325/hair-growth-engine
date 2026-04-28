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

const WelcomeNewCustomerEmail = ({ customerName, salonName = 'サロン', bookingLink }: Props) => (
  <Html lang="ja">
    <Head />
    <Preview>初めてのご来店、ありがとうございました</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>— WELCOME —</Text>
        <Heading style={h1}>{customerName ? `${customerName} 様` : 'お客様'}</Heading>
        <Text style={text}>
          このたびは{salonName}にご来店いただき、誠にありがとうございました。
          仕上がりにご満足いただけましたでしょうか。
        </Text>
        <Text style={text}>
          ご縁を大切に、{customerName ? `${customerName}様の` : 'お客様の'}
          理想の髪づくりを末永くサポートさせていただきたく存じます。
        </Text>
        <Section style={giftBox}>
          <Text style={giftLabel}>WELCOME GIFT</Text>
          <Text style={giftMain}>2回目ご予約限定 30%OFF クーポン</Text>
          <Text style={giftSub}>※有効期限：初回来店から60日間</Text>
        </Section>
        {bookingLink && (
          <Section style={{ textAlign: 'center', margin: '32px 0' }}>
            <Button href={bookingLink} style={button}>2回目のご予約はこちら</Button>
          </Section>
        )}
        <Hr style={hr} />
        <Text style={footer}>{salonName}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: WelcomeNewCustomerEmail,
  subject: (d: Record<string, any>) => `${d.salonName || 'サロン'}より ご来店の御礼と特別なご案内`,
  displayName: '新規ご来店ありがとう',
  previewData: { customerName: '山田 花子', salonName: 'ARUNE HAIR', bookingLink: 'https://example.com/book/x' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Georgia, "Hiragino Mincho ProN", serif' }
const container = { padding: '40px 32px', maxWidth: '560px' }
const eyebrow = { fontSize: '10px', letterSpacing: '0.3em', color: '#b8946a', margin: '0 0 16px' }
const h1 = { fontSize: '22px', fontWeight: 'normal' as const, color: '#1a1a1a', margin: '0 0 24px' }
const text = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.9', margin: '0 0 18px' }
const giftBox = { textAlign: 'center' as const, padding: '28px 20px', margin: '24px 0', backgroundColor: '#faf7f2', border: '1px solid #b8946a' }
const giftLabel = { fontSize: '11px', letterSpacing: '0.4em', color: '#b8946a', margin: '0 0 12px' }
const giftMain = { fontSize: '16px', color: '#1a1a1a', margin: '0 0 8px' }
const giftSub = { fontSize: '11px', color: '#888', margin: 0 }
const button = { backgroundColor: '#1a1a1a', color: '#ffffff', padding: '14px 36px', fontSize: '11px', letterSpacing: '0.2em', textDecoration: 'none' }
const hr = { borderColor: '#e8e0d4', margin: '32px 0 20px' }
const footer = { fontSize: '11px', color: '#888', letterSpacing: '0.15em', textAlign: 'center' as const }
