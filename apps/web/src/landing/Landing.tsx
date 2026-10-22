import { Hero } from "./Hero";
import { Context } from "./sections/Context";
import { HowItWorks } from "./sections/HowItWorks";

/** `/`: what Wasit is, for judges and first-time visitors. */
export default function Landing() {
  return (
    <>
      <Hero />
      <Context />
      <HowItWorks />
    </>
  );
}
