import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  customerName?: string
  salonName?: string
  menu?: string
}

const AftercareEmail = ({ customerName, salonName = 'サロン', menu }: Props) => (
  <Html lang="ja">
    <Head />
    <Preview>美しさを長持ちさせるホームケアのご案内</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>— HAIR CARE GUIDE —</Text>
        <Heading style={h1}>{customerName ? `${customerName} 様` : 'お客様'}</Heading>
        <Text style={text}>
          先日は{menu ? `「${menu}」で` : ''}ご来店いただき、誠にありがとうございました。
          そろそろ1週間が経ちますが、仕上がりはいかがでしょうか。
        </Text>
        <Section style={tipBox}>
          <Text style={tipTitle}>美しさを長持ちさせる３つのコツ</Text>
          <Text style={tip}><span style={num}>01</span> 洗髪後はタオルドライ後すぐにドライヤーで乾かす</Text>
          <Text style={tip}><span style={num}>02</span> 週１〜２回のヘアマスクで内部補修と保湿</Text>
          <Text style={tip}><span style={num}>03</span> 紫外線対策に洗い流さないトリートメントを</Text>
        </Section>
        <Text style={text}>
          気になる点・お困りごとがございましたら、お気軽にご相談ください。
          スタッフ一同、{customerName ? `${customerName}様の` : 'お客様の'}美しさをサポートいたします。
        </Text>
        <Hr style={hr} />
        <Text style={footer}>{salonName}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: AftercareEmail,
  subject: (d: Record<string, any>) => `${d.salonName || 'サロン'}より ホームケアのご案内`,
  displayName: 'アフターケア案内（7日後）',
  previewData: { customerName: '山田 花子', salonName: 'ARUNE HAIR', menu: 'カット & カラー' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Georgia, "Hiragino Mincho ProN", serif' }
const container = { padding: '40px 32px', maxWidth: '560px' }
const eyebrow = { fontSize: '10px', letterSpacing: '0.3em', color: '#b8946a', margin: '0 0 16px' }
const h1 = { fontSize: '22px', fontWeight: 'normal' as const, color: '#1a1a1a', margin: '0 0 24px' }
const text = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.9', margin: '0 0 18px' }
const tipBox = { backgroundColor: '#faf7f2', padding: '24px', margin: '24px 0', borderLeft: '2px solid #b8946a' }
const tipTitle = { fontSize: '12px', letterSpacing: '0.2em', color: '#b8946a', margin: '0 0 16px' }
const tip = { fontSize: '13px', color: '#1a1a1a', lineHeight: '1.8', margin: '8px 0' }
const num = { color: '#b8946a', fontSize: '11px', marginRight: '12px', letterSpacing: '0.1em' }
const hr = { borderColor: '#e8e0d4', margin: '32px 0 20px' }
const footer = { fontSize: '11px', color: '#888', letterSpacing: '0.15em', textAlign: 'center' as const }
