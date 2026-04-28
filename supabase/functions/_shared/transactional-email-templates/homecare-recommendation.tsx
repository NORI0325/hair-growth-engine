import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  customerName?: string
  salonName?: string
  productName?: string
  productNote?: string
}

const HomecareRecommendationEmail = ({ customerName, salonName = 'サロン', productName, productNote }: Props) => (
  <Html lang="ja">
    <Head />
    <Preview>あなたにおすすめのホームケア</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>— RECOMMENDED FOR YOU —</Text>
        <Heading style={h1}>{customerName ? `${customerName} 様` : 'お客様'}</Heading>
        <Text style={text}>
          先日のご来店、誠にありがとうございました。
          {customerName ? `${customerName}様` : 'お客様'}の髪質・お悩みに合わせて
          おすすめのホームケアアイテムをご紹介させていただきます。
        </Text>
        {productName && (
          <Section style={productBox}>
            <Text style={productLabel}>RECOMMENDED ITEM</Text>
            <Text style={productMain}>{productName}</Text>
            {productNote && <Text style={productSub}>{productNote}</Text>}
          </Section>
        )}
        <Text style={text}>
          サロンでも店頭にてお取り扱いがございます。
          次回ご来店の際にお気軽にスタッフへお声がけください。
        </Text>
        <Hr style={hr} />
        <Text style={footer}>{salonName}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: HomecareRecommendationEmail,
  subject: (d: Record<string, any>) => `${d.salonName || 'サロン'}より おすすめホームケアのご案内`,
  displayName: 'ホームケア商品案内',
  previewData: { customerName: '山田 花子', salonName: 'ARUNE HAIR', productName: 'モイスチャー リペア マスク', productNote: 'カラー後の乾燥した髪に深く浸透する集中ケアマスク' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Georgia, "Hiragino Mincho ProN", serif' }
const container = { padding: '40px 32px', maxWidth: '560px' }
const eyebrow = { fontSize: '10px', letterSpacing: '0.3em', color: '#b8946a', margin: '0 0 16px' }
const h1 = { fontSize: '22px', fontWeight: 'normal' as const, color: '#1a1a1a', margin: '0 0 24px' }
const text = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.9', margin: '0 0 18px' }
const productBox = { textAlign: 'center' as const, padding: '28px 20px', margin: '24px 0', backgroundColor: '#faf7f2', border: '1px solid #e8e0d4' }
const productLabel = { fontSize: '11px', letterSpacing: '0.4em', color: '#b8946a', margin: '0 0 12px' }
const productMain = { fontSize: '16px', color: '#1a1a1a', margin: '0 0 8px' }
const productSub = { fontSize: '12px', color: '#666', margin: 0, lineHeight: '1.7' }
const hr = { borderColor: '#e8e0d4', margin: '32px 0 20px' }
const footer = { fontSize: '11px', color: '#888', letterSpacing: '0.15em', textAlign: 'center' as const }
