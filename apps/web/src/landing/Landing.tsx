import { Hero } from "./Hero";
import { Context } from "./sections/Context";
import { HowItWorks } from "./sections/HowItWorks";
import { Protection } from "./sections/Protection";

/** `/`: what Wasit is, for judges and first-time visitors. */
export default function Landing() {
  return (
    <>
      <Hero />
      <Context />
      <HowItWorks />
      <Protection />
    </>
  );
}
