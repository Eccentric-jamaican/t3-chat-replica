import { Section, Text } from "@react-email/components";
import { EmailLayout } from "./layout";

type WelcomeEmailProps = {
  name?: string | null;
  appUrl: string;
  brandColor?: string;
};

export function WelcomeEmail({ name, appUrl, brandColor }: WelcomeEmailProps) {
  const displayName = name?.trim() || "there";
  return (
    <EmailLayout
      title="Welcome to SendCat"
      previewText="Thanks for joining SendCat."
      brandColor={brandColor}
      cta={{ label: "Go to SendCat", href: appUrl }}
      body={
        <Section>
          <Text style={styles.text}>Hi {displayName},</Text>
          <Text style={styles.text}>
            Thanks for signing up. You can now track orders, organize updates, and
            keep everything in one place.
          </Text>
          <Text style={styles.text}>
            If you ever need help, reach out to support@mail.sendcat.app and we will be
            happy to assist.
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
} as const;
