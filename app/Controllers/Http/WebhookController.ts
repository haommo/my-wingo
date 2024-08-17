// app/Controllers/Http/ShipmentHistoriesController.ts
import { HttpContextContract } from '@ioc:Adonis/Core/HttpContext'
import ShipmentHistory from 'App/Models/ShipmentHistory'

export default class ShipmentHistoriesController {
  public async store({ request, response }: HttpContextContract) {
    const { trackings } = request.only(['trackings'])
    
    if (!trackings) {
      return response.status(400).send({ error: 'Invalid data format' })
    }

    for (const tracking of trackings) {
      for (const event of tracking.events) {
        const { eventId, status, location, statusMilestone, datetime } = event

        // Check if eventId already exists
        const existingEvent = await ShipmentHistory.findBy('event_id', eventId)
        if (existingEvent) {
          continue
        }

        // Create new ShipmentHistory record
        await ShipmentHistory.create({
          event_id: eventId,
          hawb: tracking.tracker.shipmentReference,
          detail: status,
          location: location,
          status: statusMilestone,
          date: new Date(datetime)
        })
      }
    }

    return response.status(201).send({ message: 'Shipment history updated successfully' })
  }
}
