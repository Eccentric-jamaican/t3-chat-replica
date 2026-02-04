import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import React from "react";

type EmailLayoutProps = {
  title: string;
  previewText?: string;
  body: React.ReactNode;
  cta?: {
    label: string;
    href: string;
  };
  footerText?: string;
  brandColor?: string;
};

export function EmailLayout({
  title,
  previewText,
  body,
  cta,
  footerText,
  brandColor = "#111827",
}: EmailLayoutProps) {
  return (
    <Html>
      <Head />
      {previewText ? <Preview>{previewText}</Preview> : null}
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.header}>
            <Text style={styles.logo}>SendCat</Text>
          </Section>
          <Section style={styles.content}>
            <Text style={styles.title}>{title}</Text>
            <Section style={styles.bodyContent}>{body}</Section>
            {cta ? (
              <Section style={styles.cta}>
                <Button href={cta.href} style={{ ...styles.button, backgroundColor: brandColor }}>
                  {cta.label}
                </Button>
              </Section>
            ) : null}
          </Section>
          <Hr style={styles.divider} />
          <Section style={styles.footer}>
            <Text style={styles.footerText}>
              {footerText || "Questions? support@mail.sendcat.app"}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const styles = {
  body: {
    backgroundColor: "#f9fafb",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
    margin: 0,
    padding: "32px 16px",
  },
  container: {
    maxWidth: "600px",
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    padding: "32px",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.08)",
  },
  header: {
    paddingBottom: "12px",
  },
  logo: {
    fontSize: "18px",
    fontWeight: 700,
    color: "#0f172a",
    margin: "0",
    letterSpacing: "-0.02em",
  },
  content: {
    paddingTop: "8px",
  },
  title: {
    fontSize: "22px",
    fontWeight: 600,
    color: "#0f172a",
    margin: "0 0 12px 0",
  },
  bodyContent: {
    marginBottom: "20px",
  },
  cta: {
    marginTop: "12px",
    marginBottom: "8px",
  },
  button: {
    color: "#ffffff",
    fontSize: "14px",
    fontWeight: 600,
    padding: "12px 20px",
    borderRadius: "10px",
    textDecoration: "none",
    display: "inline-block",
  },
  divider: {
    borderColor: "#e5e7eb",
    margin: "24px 0 12px",
  },
  footer: {
    paddingTop: "4px",
  },
  footerText: {
    fontSize: "12px",
    color: "#6b7280",
    margin: 0,
  },
} as const;
