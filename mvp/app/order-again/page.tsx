import type { Metadata } from "next";
import { PageHeader } from "@/components/shell";
import { OrderAgainList } from "./list";

export const metadata: Metadata = { title: "Order Again" };

export default function OrderAgain() {
  return (
    <>
      <PageHeader title="Order Again" />
      <OrderAgainList />
    </>
  );
}
