import { Hero } from "./Hero";
import { ClosingCta } from "./sections/ClosingCta";
import { Context } from "./sections/Context";
import { HowItWorks } from "./sections/HowItWorks";
import { Principles } from "./sections/Principles";
import { Protection } from "./sections/Protection";

/** `/`: what Wasit is, for judges and first-time visitors. */
export default function Landing() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Context />
      <Protection />
      <Principles />
      <ClosingCta />
    </>
  );
}
