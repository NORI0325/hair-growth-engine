/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import * as S from './_styles.ts'

interface Props {
  siteName: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({ siteName, email, newEmail, confirmationUrl }: Props) => (
  <Html lang="ja">
    <Head />
    <Preview>{siteName} メールアドレス変更のご確認</Preview>
    <Body style={S.main}>
      <Container style={S.container}>
        <Text style={S.eyebrow}>— EMAIL CHANGE —</Text>
        <Heading style={S.h1}>メールアドレス変更のご確認</Heading>
        <Text style={S.text}>
          {siteName} にてメールアドレスの変更リクエストを承りました。
        </Text>
        <Text style={S.text}>
          変更前：{email}<br />
          変更後：{newEmail}
        </Text>
        <Text style={S.text}>下記のボタンより変更を確定してください。</Text>
        <Section style={S.buttonWrap}>
          <Button href={confirmationUrl} style={S.button}>変更を確定する</Button>
        </Section>
        <Text style={S.text}>
          お心当たりのない場合は、ただちにアカウントの安全をご確認くださいませ。
        </Text>
        <Hr style={S.hr} />
        <Text style={S.footer}>{siteName}</Text>
      </Container>
    </Body>
  </Html>
)

export default EmailChangeEmail
