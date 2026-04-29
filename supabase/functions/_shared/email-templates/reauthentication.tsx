/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Hr, Html, Preview, Text,
} from 'npm:@react-email/components@0.0.22'
import * as S from './_styles.ts'

interface Props { token: string }

export const ReauthenticationEmail = ({ token }: Props) => (
  <Html lang="ja">
    <Head />
    <Preview>本人確認コード</Preview>
    <Body style={S.main}>
      <Container style={S.container}>
        <Text style={S.eyebrow}>— VERIFICATION CODE —</Text>
        <Heading style={S.h1}>本人確認のご案内</Heading>
        <Text style={S.text}>下記の確認コードをご入力くださいませ。</Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={S.text}>
          コードは一定時間で無効になります。お心当たりのない場合は、このメールを破棄してください。
        </Text>
        <Hr style={S.hr} />
        <Text style={S.footer}>ARUNE HAIR</Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail

const codeStyle = {
  fontFamily: 'Georgia, monospace',
  fontSize: '28px',
  letterSpacing: '0.4em',
  color: '#231f1c',
  textAlign: 'center' as const,
  margin: '24px 0 32px',
  padding: '20px',
  backgroundColor: '#faf7f2',
  border: '1px solid #e8e0d4',
}
