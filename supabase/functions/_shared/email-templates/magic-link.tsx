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

export const MagicLinkEmail = ({ siteName, confirmationUrl }: Props) => (
  <Html lang="ja">
    <Head />
    <Preview>{siteName} ログイン用リンク</Preview>
    <Body style={S.main}>
      <Container style={S.container}>
        <Text style={S.eyebrow}>— SIGN IN LINK —</Text>
        <Heading style={S.h1}>ログイン用リンクのご案内</Heading>
        <Text style={S.text}>
          下記のボタンより {siteName} にログインいただけます。
          リンクは一定時間で無効になりますので、お早めにご利用ください。
        </Text>
        <Section style={S.buttonWrap}>
          <Button href={confirmationUrl} style={S.button}>ログインする</Button>
        </Section>
        <Text style={S.text}>
          お心当たりのない場合は、このメールを破棄してくださいませ。
        </Text>
        <Hr style={S.hr} />
        <Text style={S.footer}>{siteName}</Text>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail
