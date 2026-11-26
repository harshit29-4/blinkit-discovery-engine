import type { Metadata } from "next";
import { CartView } from "./cart-view";
import { PageHeader } from "@/components/shell";

export const metadata: Metadata = { title: "Cart" };

export default function CartPage() {
  return (
    <>
      <PageHeader title="Checkout" search={false} />
      <CartView />
    </>
  );
}
