/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import * as S from './_styles.ts'

interface Props {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({ siteName, siteUrl, recipient, confirmationUrl }: Props) => (
  <Html lang="ja">
    <Head />
    <Preview>{siteName} メールアドレスのご確認</Preview>
    <Body style={S.main}>
      <Container style={S.container}>
        <Text style={S.eyebrow}>— CONFIRM YOUR EMAIL —</Text>
        <Heading style={S.h1}>ご登録ありがとうございます</Heading>
        <Text style={S.text}>
          このたびは <Link href={siteUrl} style={S.link}>{siteName}</Link> にご登録いただき、誠にありがとうございます。
        </Text>
        <Text style={S.text}>
          下記のボタンより、メールアドレス（{recipient}）のご確認をお願いいたします。
        </Text>
        <Section style={S.buttonWrap}>
          <Button href={confirmationUrl} style={S.button}>メールアドレスを確認</Button>
        </Section>
        <Text style={S.text}>
          お心当たりのない場合は、お手数ですがこのメールを破棄してくださいませ。
        </Text>
        <Hr style={S.hr} />
        <Text style={S.footer}>{siteName}</Text>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail
