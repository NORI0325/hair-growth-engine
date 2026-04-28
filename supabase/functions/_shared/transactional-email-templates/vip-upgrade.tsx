import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  customerName?: string
  salonName?: string
  tier?: string
}

const tierLabel: Record<string, { ja: string; en: string; color: string }> = {
  silver: { ja: 'シルバー', en: 'SILVER', color: '#9ca3af' },
  gold: { ja: 'ゴールド', en: 'GOLD', color: '#c9a063' },
  platinum: { ja: 'プラチナ', en: 'PLATINUM', color: '#5a5a5a' },
}

const VipUpgradeEmail = ({ customerName, salonName = 'サロン', tier = 'gold' }: Props) => {
  const t = tierLabel[tier] || tierLabel.gold
  return (
    <Html lang="ja">
      <Head />
      <Preview>{`${t.ja}メンバーへご昇格`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={eyebrow}>— MEMBERSHIP UPGRADE —</Text>
          <Heading style={h1}>{customerName ? `${customerName} 様` : 'お客様'}</Heading>
          <Section style={{ ...badgeBox, borderColor: t.color }}>
            <Text style={{ ...badgeLabel, color: t.color }}>{t.en} MEMBER</Text>
            <Text style={badgeJa}>{t.ja}メンバーへご昇格</Text>
          </Section>
          <Text style={text}>
            いつも{salonName}をご愛顧いただき、心より感謝申し上げます。
            このたび、{customerName ? `${customerName}様` : 'お客様'}が
            <strong>{t.ja}メンバー</strong>へご昇格となりましたことをお知らせいたします。
          </Text>
          <Text style={text}>
            これからも{customerName ? `${customerName}様` : 'お客様'}に
            最高のひとときをお届けできますよう、スタッフ一同努めてまいります。
          </Text>
          <Hr style={hr} />
          <Text style={footer}>{salonName}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: VipUpgradeEmail,
  subject: (d: Record<string, any>) => {
    const t = tierLabel[d.tier as string] || tierLabel.gold
    return `${d.salonName || 'サロン'}より ${t.ja}メンバーご昇格のお知らせ`
  },
  displayName: 'VIP昇格お祝い',
  previewData: { customerName: '山田 花子', salonName: 'ARUNE HAIR', tier: 'gold' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Georgia, "Hiragino Mincho ProN", serif' }
const container = { padding: '40px 32px', maxWidth: '560px' }
const eyebrow = { fontSize: '10px', letterSpacing: '0.3em', color: '#b8946a', margin: '0 0 16px' }
const h1 = { fontSize: '22px', fontWeight: 'normal' as const, color: '#1a1a1a', margin: '0 0 24px' }
const text = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.9', margin: '0 0 18px' }
const badgeBox = { textAlign: 'center' as const, padding: '32px 20px', margin: '24px 0', border: '1px solid #c9a063', backgroundColor: '#faf7f2' }
const badgeLabel = { fontSize: '14px', letterSpacing: '0.4em', margin: '0 0 8px' }
const badgeJa = { fontSize: '12px', color: '#888', letterSpacing: '0.2em', margin: 0 }
const hr = { borderColor: '#e8e0d4', margin: '32px 0 20px' }
const footer = { fontSize: '11px', color: '#888', letterSpacing: '0.15em', textAlign: 'center' as const }
