/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import * as S from './_styles.ts'

interface Props {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({ siteName, confirmationUrl }: Props) => (
  <Html lang="ja">
    <Head />
    <Preview>{siteName} パスワード再設定のご案内</Preview>
    <Body style={S.main}>
      <Container style={S.container}>
        <Text style={S.eyebrow}>— RESET PASSWORD —</Text>
        <Heading style={S.h1}>パスワード再設定のご案内</Heading>
        <Text style={S.text}>
          {siteName} よりパスワード再設定のリクエストを承りました。
          下記のボタンより、新しいパスワードをご設定くださいませ。
        </Text>
        <Section style={S.buttonWrap}>
          <Button href={confirmationUrl} style={S.button}>パスワードを再設定</Button>
        </Section>
        <Text style={S.text}>
          お心当たりのない場合は、このメールを破棄してください。現在のパスワードはそのまま有効です。
        </Text>
        <Hr style={S.hr} />
        <Text style={S.footer}>{siteName}</Text>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail
