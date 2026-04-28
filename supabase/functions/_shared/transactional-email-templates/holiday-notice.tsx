import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  customerName?: string
  salonName?: string
  noticeTitle?: string
  noticeBody?: string
  startDate?: string
  endDate?: string
}

const HolidayNoticeEmail = ({ customerName, salonName = 'サロン', noticeTitle, noticeBody, startDate, endDate }: Props) => (
  <Html lang="ja">
    <Head />
    <Preview>{noticeTitle || '営業に関する大切なお知らせ'}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>— IMPORTANT NOTICE —</Text>
        <Heading style={h1}>{noticeTitle || '営業に関するお知らせ'}</Heading>
        {customerName && <Text style={text}>{customerName} 様</Text>}
        <Text style={text}>
          いつも{salonName}をご利用いただき、誠にありがとうございます。
        </Text>
        {(startDate || endDate) && (
          <Section style={detailBox}>
            {startDate && <Text style={detail}><span style={label}>開始　</span>{startDate}</Text>}
            {endDate && <Text style={detail}><span style={label}>再開　</span>{endDate}</Text>}
          </Section>
        )}
        <Text style={text}>
          {noticeBody || 'お知らせの詳細はこちらに記載いたします。'}
        </Text>
        <Text style={text}>
          ご不便をおかけいたしますが、何卒ご理解のほどよろしくお願い申し上げます。
        </Text>
        <Hr style={hr} />
        <Text style={footer}>{salonName}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: HolidayNoticeEmail,
  subject: (d: Record<string, any>) => `【お知らせ】${d.noticeTitle || '営業時間変更について'}`,
  displayName: '臨時休業・営業変更',
  previewData: { customerName: '山田 花子', salonName: 'ARUNE HAIR', noticeTitle: 'ゴールデンウィーク休業のお知らせ', noticeBody: '5月3日(金)〜5月6日(月)まで休業させていただきます。', startDate: '2026年5月3日(金)', endDate: '2026年5月7日(火)' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Georgia, "Hiragino Mincho ProN", serif' }
const container = { padding: '40px 32px', maxWidth: '560px' }
const eyebrow = { fontSize: '10px', letterSpacing: '0.3em', color: '#b8946a', margin: '0 0 16px' }
const h1 = { fontSize: '22px', fontWeight: 'normal' as const, color: '#1a1a1a', margin: '0 0 24px' }
const text = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.9', margin: '0 0 18px', whiteSpace: 'pre-wrap' as const }
const detailBox = { backgroundColor: '#faf7f2', padding: '20px 24px', margin: '24px 0', borderLeft: '2px solid #b8946a' }
const detail = { fontSize: '13px', color: '#1a1a1a', lineHeight: '1.8', margin: '4px 0' }
const label = { color: '#888', fontSize: '11px', letterSpacing: '0.1em' }
const hr = { borderColor: '#e8e0d4', margin: '32px 0 20px' }
const footer = { fontSize: '11px', color: '#888', letterSpacing: '0.15em', textAlign: 'center' as const }
