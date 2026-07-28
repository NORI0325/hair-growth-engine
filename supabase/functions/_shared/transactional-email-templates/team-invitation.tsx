import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  salonName?: string
  inviterName?: string
  role?: string
  inviteUrl?: string
}

const roleLabel = (role?: string) => {
  if (role === 'manager') return 'マネージャー'
  if (role === 'owner') return 'オーナー'
  return 'スタッフ'
}

const TeamInvitationEmail = ({ salonName = 'サロン', inviterName, role, inviteUrl = '#' }: Props) => (
  <Html lang="ja">
    <Head />
    <Preview>{salonName}からのチーム招待</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>— TEAM INVITATION —</Text>
        <Heading style={h1}>{salonName}</Heading>
        <Text style={text}>
          {inviterName ? `${inviterName}様より` : ''}{salonName}のチームメンバーとして招待が届きました。
        </Text>
        <Text style={text}>
          <strong>役割：</strong>{roleLabel(role)}
        </Text>
        <Text style={text}>
          下のボタンから招待を受諾し、Salon Boostへログインしてください。<br />
          招待リンクは <strong>7日間</strong>有効です。
        </Text>
        <Section style={notice}>
          <Text style={noticeText}>
            <strong>初回ログインの方へ：</strong><br />
            ボタンをクリックするとパスワード不要でログインできます。<br />
            ログイン直後に「ログイン用パスワード設定」画面が表示されますので、<br />
            次回以降のためにパスワードをご登録ください。
          </Text>
        </Section>
        <Section style={{ textAlign: 'center', margin: '32px 0' }}>
          <Button href={inviteUrl} style={button}>招待を受諾する</Button>
        </Section>
        <Text style={fineprint}>
          ボタンが機能しない場合は下記のURLをブラウザに貼り付けてください：<br />
          <span style={{ wordBreak: 'break-all' }}>{inviteUrl}</span>
        </Text>
        <Hr style={hr} />
        <Text style={footer}>{salonName} — Salon Boost</Text>
      </Container>
    </Body>
  </Html>
)

const main: React.CSSProperties = {
  backgroundColor: '#ffffff',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}
const container: React.CSSProperties = {
  margin: '0 auto', padding: '40px 24px', maxWidth: '560px',
}
const eyebrow: React.CSSProperties = {
  fontSize: '11px', letterSpacing: '0.2em', color: '#C9A961', textAlign: 'center', margin: '0 0 16px',
}
const h1: React.CSSProperties = {
  fontFamily: 'Georgia, serif', fontSize: '28px', textAlign: 'center', color: '#1a1a1a', margin: '0 0 24px',
}
const text: React.CSSProperties = {
  fontSize: '15px', lineHeight: '1.7', color: '#333', margin: '0 0 16px',
}
const button: React.CSSProperties = {
  backgroundColor: '#1a1a1a', color: '#ffffff', padding: '14px 32px', borderRadius: '4px',
  fontSize: '14px', textDecoration: 'none', display: 'inline-block',
}
const fineprint: React.CSSProperties = {
  fontSize: '12px', color: '#888', margin: '16px 0 0', lineHeight: '1.5',
}
const notice: React.CSSProperties = {
  background: '#FAF6EC', border: '1px solid #E8DDB8', padding: '14px 18px', margin: '8px 0 16px',
}
const noticeText: React.CSSProperties = {
  fontSize: '13px', color: '#5a4a1a', lineHeight: '1.7', margin: 0,
}
const hr: React.CSSProperties = { border: 'none', borderTop: '1px solid #eee', margin: '32px 0 16px' }
const footer: React.CSSProperties = {
  fontSize: '12px', color: '#999', textAlign: 'center', margin: '0',
}

export const template: TemplateEntry = {
  component: TeamInvitationEmail,
  subject: (data) => `${data.salonName ?? 'サロン'} からチーム招待が届いています`,
  displayName: 'チーム招待',
  previewData: {
    salonName: 'Arune hair',
    inviterName: 'オーナー',
    role: 'manager',
    inviteUrl: 'https://saronboost.com/invite/sample-token',
  },
}
