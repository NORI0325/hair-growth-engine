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

export const InviteEmail = ({ siteName, confirmationUrl }: Props) => (
  <Html lang="ja">
    <Head />
    <Preview>{siteName} へのご招待</Preview>
    <Body style={S.main}>
      <Container style={S.container}>
        <Text style={S.eyebrow}>— INVITATION —</Text>
        <Heading style={S.h1}>{siteName} へのご招待</Heading>
        <Text style={S.text}>
          {siteName} へご招待いたします。下記のボタンよりアカウントを作成し、ご参加くださいませ。
        </Text>
        <Section style={S.buttonWrap}>
          <Button href={confirmationUrl} style={S.button}>招待を承諾する</Button>
        </Section>
        <Text style={S.text}>
          お心当たりのない場合は、このメールを破棄してください。
        </Text>
        <Hr style={S.hr} />
        <Text style={S.footer}>{siteName}</Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail
