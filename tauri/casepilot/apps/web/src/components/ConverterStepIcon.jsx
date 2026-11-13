import React from "react"
import {
  ArrowDownToLine,
  ArrowRightLeft,
  Banknote,
  Coins,
  Gem,
  PackageOpen,
  ShoppingBag,
  Ticket,
} from "lucide-react"

const icons = {
  sell: Banknote,
  buy: ShoppingBag,
  open: PackageOpen,
  "convert-stickers": Ticket,
  "convert-inventory": Coins,
  mint: Gem,
  transfer: ArrowRightLeft,
  "convert-received": ArrowDownToLine,
}

export const stepCaptions = {
  sell: "Caixas → dinheiro",
  buy: "Dinheiro → cápsulas",
  open: "Cápsulas → stickers",
  "convert-stickers": "Stickers → tokens",
  "convert-inventory": "Skins → tokens",
  mint: "Tokens → skins",
  transfer: "Tokens ou skins → Main",
  "convert-received": "Recebidas → tokens",
}

export default function ConverterStepIcon({ step, ...props }) {
  const Icon = icons[step] || Coins
  return <Icon aria-hidden="true" {...props} />
}
