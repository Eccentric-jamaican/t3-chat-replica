import { Section, Text } from "@react-email/components";
import { EmailLayout } from "./layout";

type ResetPasswordEmailProps = {
  name?: string | null;
  resetUrl: string;
  brandColor?: string;
};

export function ResetPasswordEmail({
  name,
  resetUrl,
  brandColor,
}: ResetPasswordEmailProps) {
  const displayName = name?.trim() || "there";
  return (
    <EmailLayout
      title="Reset your password"
      previewText="Use this link to reset your SendCat password."
      brandColor={brandColor}
      cta={{ label: "Reset Password", href: resetUrl }}
      body={
        <Section>
          <Text style={styles.text}>Hi {displayName},</Text>
          <Text style={styles.text}>
            We received a request to reset your SendCat password. If you made this
            request, click the button below.
          </Text>
          <Text style={styles.notice}>
            If you did not request this, you can safely ignore this email.
          </Text>
        </Section>
      }
      footerText="Questions? support@mail.sendcat.app"
    />
  );
}

const styles = {
  text: {
    fontSize: "14px",
    lineHeight: "20px",
    color: "#334155",
    margin: "0 0 12px 0",
  },
  notice: {
    fontSize: "13px",
    lineHeight: "18px",
    color: "#64748b",
    margin: "0",
  },
} as const;
