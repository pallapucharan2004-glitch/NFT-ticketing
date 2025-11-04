import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { useSnackbar } from 'notistack'
import { NftBookingsFactory } from '../contracts/NftBookings'
import { getAlgodConfigFromViteEnvironment, getIndexerConfigFromViteEnvironment } from '../utils/network/getAlgoClientConfigs'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import algosdk from 'algosdk'
import { CONFIG } from '../config'

interface BuyTicketModalProps {
  openModal: boolean
  closeModal: () => void
}

const BuyTicketModal: React.FC<BuyTicketModalProps> = ({ openModal, closeModal }) => {
  const [eventId, setEventId] = useState<string>('')
  const [receiverAddress, setReceiverAddress] = useState<string>('2ZTFJNDXPWDETGJQQN33HAATRHXZMBWESKO2AUFZUHERH2H3TG4XTNPL4Y')
  
  const [loading, setLoading] = useState<boolean>(false)
  const [ticketPrice, setTicketPrice] = useState<number | null>(null)
  const { enqueueSnackbar } = useSnackbar()
  const { transactionSigner, activeAddress } = useWallet()

  const algodConfig = getAlgodConfigFromViteEnvironment()
  const indexerConfig = getIndexerConfigFromViteEnvironment()

  const algorand = useMemo(() => AlgorandClient.fromConfig({ algodConfig, indexerConfig }), [algodConfig, indexerConfig])
  if (transactionSigner) algorand.setDefaultSigner(transactionSigner)

  const algodClient = useMemo(
    () => new algosdk.Algodv2(algodConfig.token as string || '', algodConfig.server, algodConfig.port),
    [algodConfig]
  )

  const appFactory = useMemo(() => {
    if (!activeAddress || !transactionSigner) return null
    return new NftBookingsFactory(algodClient, activeAddress, transactionSigner, CONFIG.IS_DEVELOPMENT)
  }, [algodClient, activeAddress, transactionSigner])

  const getAppClient = useCallback(() => {
    if (!appFactory) throw new Error('Wallet not connected or factory not initialized')
    return appFactory.getClient(CONFIG.APP_ID)
  }, [appFactory])

  // Fetch ticket price when eventId changes
  useEffect(() => {
    const fetchTicketPrice = async () => {
      if (!eventId || !activeAddress || !transactionSigner) {
        setTicketPrice(null)
        return
      }
      try {
        const appClient = getAppClient()
        const priceMicro = await appClient.getTicketPrice()
        setTicketPrice(priceMicro / 1_000_000) // convert to ALGO
      } catch (e: any) {
        console.error('Error fetching ticket price:', e)
        setTicketPrice(null)
        const errorMessage = e instanceof Error ? e.message : 'Unable to fetch ticket price'
        enqueueSnackbar(errorMessage, { variant: 'error' })
      }
    }
    fetchTicketPrice()
  }, [eventId, activeAddress, transactionSigner, getAppClient, enqueueSnackbar])

  const handleBuyTicket = async () => {
    if (!activeAddress || !transactionSigner) {
      enqueueSnackbar('Please connect your wallet first', { variant: 'warning' })
      return
    }
    if (!eventId) {
      enqueueSnackbar('Please enter an Event ID', { variant: 'error' })
      return
    }
    if (!receiverAddress) {
      enqueueSnackbar('Please enter a receiver address', { variant: 'error' })
      return
    }
    if (!ticketPrice || ticketPrice <= 0) {
      enqueueSnackbar('Ticket price not available', { variant: 'error' })
      return
    }



    setLoading(true)
    try {
      const appClient = getAppClient()

      // Create payment transaction for the ticket price
      const suggestedParams = await algodClient.getTransactionParams().do()
      const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: receiverAddress,
        amount: ticketPrice * 1_000_000, // Convert ALGO to microAlgos
        suggestedParams,
      })

      const response = await appClient.bookTicket(Number(eventId), paymentTxn)
      enqueueSnackbar(`Ticket booked successfully! Ticket ID: ${response}`, { variant: 'success' })
      closeModal()
      setEventId('')
      setReceiverAddress('2ZTFJNDXPWDETGJQQN33HAATRHXZMBWESKO2AUFZUHERH2H3TG4XTNPL4Y')
      setTicketPrice(null)

      // Refresh tickets in TicketList component
      window.dispatchEvent(new CustomEvent('refreshTickets'))
    } catch (e: any) {
      console.error('Error booking ticket:', e)
      const errorMessage = e instanceof Error ? e.message : 'Unknown error'
      enqueueSnackbar(`Error booking ticket: ${errorMessage}`, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <dialog id="buy_ticket_modal" className={`modal ${openModal ? 'modal-open' : ''} bg-slate-200`}>
      <form method="dialog" className="modal-box" onSubmit={(e) => e.preventDefault()}>
        <h3 className="font-bold text-lg mb-2">Buy Ticket</h3>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Event ID</label>
          <input
            type="number"
            placeholder="Event ID (paste from created event)"
            className="input input-bordered w-full"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
          />
          <p className="text-xs text-gray-500 mt-1">Enter the Event ID generated after creating an event</p>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Receiver Address</label>
          <input
            type="text"
            placeholder="Receiver Address"
            className="input input-bordered w-full"
            value={receiverAddress}
            onChange={(e) => setReceiverAddress(e.target.value)}
          />
          <p className="text-xs text-gray-500 mt-1">Address where ticket payment will be sent</p>
        </div>

        {ticketPrice !== null && (
          <p className="text-sm text-gray-600 mb-4">
            Ticket Price: {ticketPrice} ALGO
          </p>
        )}

        <div className="modal-action">
          <button type="button" className="btn" onClick={closeModal}>Close</button>
          <button
            type="button"
            className={`btn btn-primary ${loading ? 'loading' : ''}`}
            onClick={handleBuyTicket}
            disabled={loading || !ticketPrice}
          >
            {loading ? 'Booking...' : 'Buy Ticket'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

export default BuyTicketModal
